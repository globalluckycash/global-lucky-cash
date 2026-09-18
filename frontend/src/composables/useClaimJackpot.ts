import { reactive, ref } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { broadcastTransaction } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseJPCommitment, parseTicketCommitment } from '@/lib/nftDecode'
import { leHex } from '@/lib/bytes'
import { useWalletStore } from '@/stores/wallet'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState, Utxo } from '@/types'

const FEE_RATE = 1
const DUST = 1000n

export interface ClaimJackpotParams {
  ticketUtxo: Utxo  // Player's TicketNFT (claimStatus = 00, consumed)
  jpUtxo: Utxo      // Matching JackpotPoolNFT
}

export function useClaimJackpot() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  // Once broadcast, the new TicketNFT's content (output[1]) is already known, so the UI can
  // show the claimed status immediately without waiting for electrum re-indexing
  const newTicketUtxo = ref<Utxo | null>(null)

  async function execute(params: ClaimJackpotParams): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null
    newTicketUtxo.value = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const playerAddress = walletStore.address
      if (!playerAddress) throw new NotConnectedError()

      const { ticketUtxo, jpUtxo } = params
      const jp = parseJPCommitment(jpUtxo.token!.nft!.commitment)
      const ticket = parseTicketCommitment(ticketUtxo.token!.nft!.commitment)

      if (jp.claimCount === 0) throw new Error('No winners for this jackpot pool')
      if (Date.now() / 1000 > Number(jp.lastClaimTime)) throw new Error('Jackpot claim period has expired')

      const playerUtxos = await fetchPlayerUtxos()
      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))

      const prizeAmount = jpUtxo.valueSats / BigInt(jp.claimCount) - 1000n / BigInt(jp.claimCount)
      const newClaimCount = jp.claimCount - 1
      const existingC = jpUtxo.token!.nft!.commitment
      // JP commitment byte[10] = claimCount at hex offset [20..21]
      const newJpCommitment = existingC.slice(0, 20) + leHex(newClaimCount, 1) + existingC.slice(22)

      // Ticket commitment: flip claimStatus (byte 13, hex[26..27]) from '00' to '01'
      // (0x01 = jackpot's own code, kept distinct from fixed prizes' 0x02-0x05)
      const existingTicketC = ticketUtxo.token!.nft!.commitment
      const newTicketCommitment = existingTicketC.slice(0, 26) + '01'

      const playerLockHex = getLockingBytecodeHex(playerAddress)

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(jpUtxo), cfg.jackpotPoolContract.unlock.claimJackpot())
      txBuilder.addInput(toCsUtxo(ticketUtxo), placeholderP2PKHUnlocker(playerAddress))

      // Output[0]: JP NFT (BCH -= prizeAmount, claimCount -= 1)
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: jpUtxo.valueSats - prizeAmount,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newJpCommitment } },
      })
      // Output[1]: new TicketNFT (claimStatus=01), sent back to the player; original TicketNFT consumed
      txBuilder.addOutput({
        to: playerAddress,
        amount: ticketUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment: newTicketCommitment } },
      })
      // Output[2]: prize amount to the player
      txBuilder.addOutput({ to: playerAddress, amount: prizeAmount })

      // Input[2+]: player plain BCH, added smallest-first until fee + change dust is covered.
      // Fee is computed from the tx's actual current size (including placeholder-P2PKH
      // correction). JP/ticket BCH flow is already balanced (jpUtxo's decrease equals
      // prizeAmount, ticketUtxo passes through unchanged), so only fee + dust need covering.
      // Contract requires tx.outputs.length == 4, with Output[3] as change.
      const sortedPlayerUtxos = [...playerUtxos].sort((a, b) =>
        a.utxo.valueSats < b.utxo.valueSats ? -1 : a.utxo.valueSats > b.utxo.valueSats ? 1 : 0
      )
      const selectedPlayerUtxos: typeof playerUtxos = []
      let payTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 1)
      let surplus = payTotal - fee
      for (const pu of sortedPlayerUtxos) {
        if (surplus >= DUST) break
        txBuilder.addInput(toCsUtxo(pu.utxo), placeholderP2PKHUnlocker(pu.address))
        selectedPlayerUtxos.push(pu)
        payTotal += pu.utxo.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, 1 + selectedPlayerUtxos.length)
        surplus = payTotal - fee
      }
      if (surplus < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }

      const playerUtxoAddresses = selectedPlayerUtxos.map(pu => pu.address)

      // Output[3]: change (contract-required output). Placeholder amount added first, filled
      // in with the exact value once tx size (including this output's own bytes) is known, so
      // it doesn't fall below the contract's 1000-sat minimum.
      const changeOutputIndex = txBuilder.outputs.length
      txBuilder.addOutput({ to: playerAddress, amount: DUST })
      fee = estimateFeeForWc(txBuilder, FEE_RATE, 1 + selectedPlayerUtxos.length)
      const changeValue = payTotal - fee
      if (changeValue < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }
      txBuilder.outputs[changeOutputIndex].amount = changeValue

      const txHex = txBuilder.build()

      // JP contract (0), ticket P2PKH (1), fee inputs (2+)
      const sourceOutputs = [
        toSourceOutput(jpUtxo, cfg.jackpotPoolContract.lockingBytecode),
        toSourceOutput(ticketUtxo, playerLockHex),
        ...selectedPlayerUtxos.map((pu, i) => toSourceOutput(pu.utxo, getLockingBytecodeHex(playerUtxoAddresses[i]))),
      ]

      // ticket input at index 1 uses receive[0] by convention
      const ticketInputPath: [number, string, number] = [1, 'receive', 0]
      const feeInputPaths = selectedPlayerUtxos.map((pu, i) => [
        2 + i,
        pu.pathName,
        pu.addressIndex,
      ] as [number, string, number])
      const inputPaths = [ticketInputPath, ...feeInputPaths]

      function applySuccess(txid: string) {
        state.txid = txid
        newTicketUtxo.value = {
          txid,
          vout: 1,
          valueSats: ticketUtxo.valueSats,
          token: { category: cfg.authNftCategoryId, nft: { capability: 'none', commitment: newTicketCommitment } },
        }
        state.status = 'success'
      }

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.claim_jackpot'))
        applySuccess(await broadcastTransaction(signedTxHex))
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        state.status = 'verifying'
        const recovered = await pollForCommitment(playerAddress, cfg.authNftCategoryId, newTicketCommitment)
        if (!recovered) throw new Error(i18n.global.t('errors.wallet_result_unknown'))
        applySuccess(recovered.txid)
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      state.status = 'error'
    }
  }

  function reset() {
    state.status = 'idle'
    state.txid = null
    state.error = null
    newTicketUtxo.value = null
  }

  return { state, execute, reset, newTicketUtxo }
}

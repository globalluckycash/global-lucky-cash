import { reactive } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { broadcastTransaction } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseJPCommitment, buildJPCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState, Utxo } from '@/types'

const DUST = 1000n
const FEE_RATE = 1

export interface ProcessExpiredParams {
  expiredJpUtxo: Utxo  // Expired JP (consumed; BCH redistributed)
  activeJpUtxo: Utxo   // Accumulating JP (receives 60%)
}

export function useProcessExpired() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })

  async function execute(params: ProcessExpiredParams): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const operatorAddress = walletStore.address
      if (!operatorAddress) throw new NotConnectedError()

      const { expiredJpUtxo, activeJpUtxo } = params
      const expiredState = parseJPCommitment(expiredJpUtxo.token!.nft!.commitment)

      const playerUtxos = await fetchPlayerUtxos()
      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))

      // JackpotPool.cash processExpired(): expiredBCH excludes the dust the expired pool keeps
      // for itself (Output[0]); shares split 60/35/4/1 (jackpot/fixed/platform/execute), with
      // execute taking the remainder after the other three shares.
      const expiredBCH = expiredJpUtxo.valueSats - DUST
      const jackpotShare = expiredBCH * 60n / 100n
      const fixedShare = expiredBCH * 35n / 100n
      const platformShare = expiredBCH * 4n / 100n
      const executeShare = expiredBCH - jackpotShare - fixedShare - platformShare

      // JackpotPool.cash processExpired() requires tx.time >= lastClaimTime, so locktime is
      // set to exactly lastClaimTime.
      const locktime = Number(expiredState.lastClaimTime)

      const newExpiredCommitment = buildJPCommitment({ ...expiredState, claimCount: 0 })

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.setLocktime(locktime)
      txBuilder.addInput(toCsUtxo(expiredJpUtxo), cfg.jackpotPoolContract.unlock.processExpired(), { sequence: 0xfffffffe })
      txBuilder.addInput(toCsUtxo(activeJpUtxo), cfg.jackpotPoolContract.unlock.receiveExpiredJackpot(), { sequence: 0xfffffffe })

      // Output[0]: expired JP pool, zeroed out to dust only; claimCount reset to 0
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: DUST,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newExpiredCommitment } },
      })
      // Output[1]: accumulating JP pool, BCH += 60%, commitment unchanged
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: activeJpUtxo.valueSats + jackpotShare,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: activeJpUtxo.token!.nft!.commitment } },
      })
      // Output[2]/[3]: fixed prize pool / platform pool, plain BCH, no NFT
      txBuilder.addOutput({ to: cfg.fixedPrizePoolContract.address, amount: fixedShare })
      txBuilder.addOutput({ to: cfg.platformPoolContract.address, amount: platformShare })
      // Output[4]: execute reward address, plain BCH, equal to executeShare, separate from change
      txBuilder.addOutput({ to: operatorAddress, amount: executeShare })

      // Input[2+]: operator plain BCH, added one at a time until change (Output[5], at least
      // 1000 sats) is covered; fee computed from the tx's actual current size (including
      // placeholder-P2PKH correction). Fee and change dust come entirely from these operator
      // UTXOs, not from executeShare.
      const selectedPlayerUtxos: typeof playerUtxos = []
      let payTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
      let surplus = payTotal - fee
      for (const pu of playerUtxos) {
        if (surplus >= DUST) break
        txBuilder.addInput(toCsUtxo(pu.utxo), placeholderP2PKHUnlocker(pu.address))
        selectedPlayerUtxos.push(pu)
        payTotal += pu.utxo.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedPlayerUtxos.length)
        surplus = payTotal - fee
      }
      if (surplus < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }

      // Output[5]: change BCH, separate from the execute reward; placeholder amount filled in
      // once tx size is known
      const changeOutputIndex = txBuilder.outputs.length
      txBuilder.addOutput({ to: operatorAddress, amount: DUST })
      fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedPlayerUtxos.length)
      const changeValue = payTotal - fee
      if (changeValue < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }
      txBuilder.outputs[changeOutputIndex].amount = changeValue

      const txHex = txBuilder.build()

      // Contract inputs: expiredJp(0), activeJp(1); fee inputs start at 2
      const contractInputCount = 2
      const playerUtxoAddresses = selectedPlayerUtxos.map(pu => pu.address)
      const sourceOutputs = [
        toSourceOutput(expiredJpUtxo, cfg.jackpotPoolContract.lockingBytecode),
        toSourceOutput(activeJpUtxo, cfg.jackpotPoolContract.lockingBytecode),
        ...selectedPlayerUtxos.map((pu, i) => toSourceOutput(pu.utxo, getLockingBytecodeHex(playerUtxoAddresses[i]))),
      ]
      const inputPaths = selectedPlayerUtxos.map((pu, i) => [
        contractInputCount + i,
        pu.pathName,
        pu.addressIndex,
      ] as [number, string, number])

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.process_expired'))
        state.txid = await broadcastTransaction(signedTxHex)
        state.status = 'success'
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing; verify whether
        // the zeroed-out expired pool's new commitment already appeared at the JP contract's
        // own address.
        state.status = 'verifying'
        const recovered = await pollForCommitment(cfg.jackpotPoolContract.tokenAddress, cfg.authNftCategoryId, newExpiredCommitment)
        if (!recovered) throw new Error(i18n.global.t('errors.wallet_result_unknown'))
        state.txid = recovered.txid
        state.status = 'success'
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
  }

  return { state, execute, reset }
}

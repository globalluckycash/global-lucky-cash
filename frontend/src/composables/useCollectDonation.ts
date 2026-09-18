import { reactive } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchJackpotPoolUtxo, fetchOrphanDonationUtxos, broadcastTransaction } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError, type PlayerUtxo } from '@/lib/walletBridge'
import { parseJPCommitment, buildJPCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState } from '@/types'

const DUST = 1000n
const FEE_RATE = 1

/**
 * Sweeps stray plain BCH sent to the JackpotPool contract address (no NFT attached) into the
 * current jackpot total. Anyone can trigger it; the triggerer receives 10% as an execute reward
 * (contracts/JackpotPool.cash collectDonation()). Distinct from playerDonation()/usePlayerDonation.ts,
 * which takes a message and a specified amount.
 */
export function useCollectDonation() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })

  async function execute(): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const triggerAddress = walletStore.address
      if (!triggerAddress) throw new NotConnectedError()

      const jpUtxo = await fetchJackpotPoolUtxo()
      const jpState = parseJPCommitment(jpUtxo.token!.nft!.commitment)

      const orphanUtxos = await fetchOrphanDonationUtxos()
      if (orphanUtxos.length === 0) {
        throw new Error('No stray plain BCH found at the JackpotPool contract address to collect')
      }
      const totalBCH = orphanUtxos.reduce((sum, u) => sum + u.valueSats, 0n)

      // Jackpot share computed first via integer division; reward takes the remainder
      // (absorbs rounding), matching contracts/JackpotPool.cash collectDonation()
      const jpIncrease = totalBCH * 90n / 100n
      const reward = totalBCH - jpIncrease
      if (reward <= DUST) {
        throw new Error(`Stray funds total ${totalBCH} sats too small: reward ${reward} sats is below dust, not worth collecting yet`)
      }

      const newJpValue = jpUtxo.valueSats + jpIncrease
      const newJpCommitment = buildJPCommitment({ ...jpState, totalBCH: newJpValue })

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(jpUtxo), cfg.jackpotPoolContract.unlock.collectDonation()) // Input[0]
      for (const u of orphanUtxos) {
        txBuilder.addInput(toCsUtxo(u), cfg.jackpotPoolContract.unlock.spendDonation()) // Input[1..N]
      }

      // Output[0]: JackpotPoolNFT, back to its own contract address, BCH += jpIncrease
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: newJpValue,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newJpCommitment } },
      })

      // Input[N+1]: triggerer's plain BCH, at least 1 UTXO, kept separate from the Input[1..N]
      // stray UTXOs. Contract only counts Input[1..donationCount] toward totalBCH; Input[N+1]'s
      // lockingBytecode is the destination for Output[1]'s execute reward.
      const playerUtxos = await fetchPlayerUtxos()
      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))

      const covenantInTotal = jpUtxo.valueSats + totalBCH
      const selectedUtxos: PlayerUtxo[] = []
      let payTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
      let surplus = covenantInTotal - newJpValue - fee
      for (const pu of playerUtxos) {
        if (selectedUtxos.length >= 1 && surplus >= DUST) break
        txBuilder.addInput(toCsUtxo(pu.utxo), placeholderP2PKHUnlocker(pu.address))
        selectedUtxos.push(pu)
        payTotal += pu.utxo.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedUtxos.length)
        surplus = covenantInTotal + payTotal - newJpValue - fee
      }
      if (selectedUtxos.length < 1) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }
      if (surplus < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }

      // Output[1]: execute reward + change, to the triggerer (placeholder amount added first,
      // filled in with the exact value once fee is computed)
      const rewardOutputIndex = txBuilder.outputs.length
      txBuilder.addOutput({ to: triggerAddress, amount: DUST })

      fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedUtxos.length)
      const rewardValue = covenantInTotal + payTotal - newJpValue - fee
      if (rewardValue < DUST) throw new Error(i18n.global.t('toast.insufficient_balance'))
      txBuilder.outputs[rewardOutputIndex].amount = rewardValue

      const txHex = txBuilder.build()

      const sourceOutputs = [
        toSourceOutput(jpUtxo, cfg.jackpotPoolContract.lockingBytecode),
        ...orphanUtxos.map(u => toSourceOutput(u, cfg.jackpotPoolContract.lockingBytecode)),
        ...selectedUtxos.map(pu => toSourceOutput(pu.utxo, getLockingBytecodeHex(pu.address))),
      ]
      const inputPaths = selectedUtxos.map((pu, i) => [
        1 + orphanUtxos.length + i,
        pu.pathName,
        pu.addressIndex,
      ] as [number, string, number])

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.collect_donation'))
        state.txid = await broadcastTransaction(signedTxHex)
        state.status = 'success'
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing. JackpotPool has a
        // single persistent UTXO per round, so verify whether the updated commitment already
        // appeared at the contract's own address (rather than relying on the player's own
        // reward-change output).
        state.status = 'verifying'
        const recovered = await pollForCommitment(cfg.jackpotPoolContract.tokenAddress, cfg.authNftCategoryId, newJpCommitment)
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

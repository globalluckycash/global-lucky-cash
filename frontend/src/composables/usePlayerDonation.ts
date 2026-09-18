import { reactive } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchJackpotPoolUtxo, broadcastTransaction } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError, type PlayerUtxo } from '@/lib/walletBridge'
import {
  parseJPCommitment,
  buildJPCommitment,
  buildDonationMessageCommitment,
  buildMessageLockingBytecode,
  messageHashHex,
} from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState } from '@/types'

const DUST = 1000n
const FEE_RATE = 1

/** Contract-side floor on donationAmount for playerDonation() (contracts/JackpotPool.cash) */
export const MIN_DONATION_SATS = 5000n

/**
 * Player-initiated donation: single transaction, single signature. Distinct from
 * collectDonation()/useCollectDonation (trigger-operated sweep of stray funds, takes a
 * 10% execute reward).
 *
 * playerDonation()'s donationAmount is an independent parameter, not an automatic sum of
 * input amounts: it's fixed to the user-entered amountSats, and any surplus from the donor's
 * plain BCH input(s) is returned exactly via Output[2]'s change. Change goes to Input[1]'s
 * address (the first selected UTXO), so a single plain BCH UTXO covers both the donation and
 * the fee.
 */
export function usePlayerDonation() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })

  async function execute(amountSats: bigint, message?: string): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null

    try {
      if (amountSats < MIN_DONATION_SATS) {
        throw new Error(`捐款金額至少需 ${MIN_DONATION_SATS} sats`)
      }

      const cfg = getConfig()
      const walletStore = useWalletStore()
      const donorAddress = walletStore.address
      if (!donorAddress) throw new NotConnectedError()

      const jpUtxo = await fetchJackpotPoolUtxo()
      const jpState = parseJPCommitment(jpUtxo.token!.nft!.commitment)

      const messageLockingBytecode = buildMessageLockingBytecode(message)
      const messageHash = messageHashHex(messageLockingBytecode)

      const playerUtxos = await fetchPlayerUtxos()
      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))

      const newJpValue = jpUtxo.valueSats + amountSats
      const newJpCommitment = buildJPCommitment({ ...jpState, totalBCH: newJpValue })
      const donationMessageCommitment = buildDonationMessageCommitment({
        round: jpState.currentDrawRound + 1,
        donationTotal: amountSats,
        messageHash,
      })

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(
        toCsUtxo(jpUtxo),
        cfg.jackpotPoolContract.unlock.playerDonation(messageLockingBytecode, amountSats),
      )

      // Output[0]: JackpotPoolNFT (back to its own contract, BCH += amountSats)
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: newJpValue,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newJpCommitment } },
      })
      // Output[1]: DonationMessageNFT (newly minted)
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: DUST,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment: donationMessageCommitment } },
      })

      // Input[1..N]: donor's plain BCH. Contract counts all of Input[1..N] toward
      // donationTotal and returns change to Input[1]'s address, so one loop selects UTXOs
      // until the total covers donationAmount + the new DonationMessageNFT's dust + fee +
      // change dust.
      const selectedUtxos: PlayerUtxo[] = []
      let payTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
      let surplus = payTotal - amountSats - DUST - fee
      for (const pu of playerUtxos) {
        if (payTotal >= amountSats && surplus >= DUST) break
        txBuilder.addInput(toCsUtxo(pu.utxo), placeholderP2PKHUnlocker(pu.address))
        selectedUtxos.push(pu)
        payTotal += pu.utxo.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedUtxos.length)
        surplus = payTotal - amountSats - DUST - fee
      }
      if (payTotal < amountSats) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }
      if (surplus < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }

      // Output[2]: change BCH to the donor (contract requires it match Input[1]'s address);
      // added with a placeholder amount, filled in after the fee is computed.
      const changeOutputIndex = txBuilder.outputs.length
      txBuilder.addOutput({ to: selectedUtxos[0].address, amount: DUST })

      // Output[3]: OP_RETURN with the message. Contract requires exactly 4 outputs with
      // OP_RETURN last, so addBchChangeOutputForWc (which appends change as a 5th output)
      // can't be used here. Added before the fee is computed so estimateFeeForWc counts its
      // bytes toward the fee.
      txBuilder.addOutput({ to: messageLockingBytecode, amount: 0n })

      fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedUtxos.length)
      const changeValue = payTotal - amountSats - DUST - fee
      if (changeValue < DUST) throw new Error(i18n.global.t('toast.insufficient_balance'))
      txBuilder.outputs[changeOutputIndex].amount = changeValue

      const txHex = txBuilder.build()

      const sourceOutputs = [
        toSourceOutput(jpUtxo, cfg.jackpotPoolContract.lockingBytecode),
        ...selectedUtxos.map(pu => toSourceOutput(pu.utxo, getLockingBytecodeHex(pu.address))),
      ]
      const inputPaths = selectedUtxos.map((pu, i) => [1 + i, pu.pathName, pu.addressIndex] as [number, string, number])

      state.status = 'awaiting_signature'
      try {
        const donationBch = (Number(amountSats) / 1e8).toFixed(8)
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.player_donation', { amount: donationBch }))
        state.txid = await broadcastTransaction(signedTxHex)
        state.status = 'success'
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing; verify whether
        // the donation's newly minted DonationMessageNFT already appeared at the JackpotPool
        // address.
        state.status = 'verifying'
        const recovered = await pollForCommitment(cfg.jackpotPoolContract.tokenAddress, cfg.authNftCategoryId, donationMessageCommitment)
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

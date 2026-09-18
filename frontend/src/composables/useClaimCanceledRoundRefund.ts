import { reactive, ref } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchCRUtxoForRound, fetchFPPFundingUtxos, broadcastTransaction } from '@/lib/electrum'
import { requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseTicketCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { ticketPriceSats } from '@/lib/pricing'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState, Utxo } from '@/types'

const DUST = 1000n
const FEE_RATE = 1
// Contract-side fee cap (FixedPrizePool.cash claimCanceledRoundRefund()'s maxFee)
const CONTRACT_MAX_BASE_FEE = 2000n
const CONTRACT_MAX_PER_FUNDING_FEE = 2200n
// Cap on funding UTXOs: each P2SH input carries a full redeem script, so too many bloat the
// tx — past this count the pool needs consolidating first
const MAX_FUNDING_UTXOS = 40

export interface ClaimCanceledRoundRefundParams {
  ticketUtxo: Utxo
  round: number
}

/**
 * Canceled-round refund: the player redeems their round's TicketNFT together with FPP's
 * CanceledRoundNFT to reclaim the original ticket price (converted at the sale rate, no
 * prize multiplier). See scripts/claimCanceledRoundRefund.ts.
 */
export function useClaimCanceledRoundRefund() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  // Once broadcast, the new TicketNFT's content (output[0]) is already known, so the UI can
  // show the refunded status immediately without waiting for electrum re-indexing
  const newTicketUtxo = ref<Utxo | null>(null)

  async function execute(params: ClaimCanceledRoundRefundParams): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null
    newTicketUtxo.value = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const playerAddress = walletStore.address
      if (!playerAddress) throw new NotConnectedError()

      const { ticketUtxo, round } = params
      const ticket = parseTicketCommitment(ticketUtxo.token!.nft!.commitment)
      // Refund amount (sats): original ticket price converted at the sale rate (no prize
      // multiplier); purchaseRate is scaled ×100 (ATTESTATION_SCALING), divide back out
      const refundSats = ticketPriceSats(ticket.purchaseRate)

      const crUtxo = await fetchCRUtxoForRound(round)
      if (!crUtxo) throw new Error(`CanceledRoundNFT not found for round ${round}`)

      // Update the TicketNFT commitment (claimStatus 0x00 → 0x10, at hex[26:28])
      const existingC = ticketUtxo.token!.nft!.commitment
      const newTicketCommitment = existingC.slice(0, 26) + '10' + existingC.slice(28)

      const playerLockHex = getLockingBytecodeHex(playerAddress)

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(ticketUtxo), placeholderP2PKHUnlocker(playerAddress))
      txBuilder.addInput(toCsUtxo(crUtxo), cfg.fixedPrizePoolContract.unlock.claimCanceledRoundRefund())

      txBuilder.addOutput({
        to: playerAddress,
        amount: ticketUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment: newTicketCommitment } },
      })
      txBuilder.addOutput({
        to: cfg.fixedPrizePoolContract.tokenAddress,
        amount: crUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: crUtxo.token!.nft!.commitment } },
      })
      txBuilder.addOutput({ to: playerAddress, amount: refundSats })

      // Output[3]: fixed-prize-pool change — placeholder amount, filled in once funding UTXOs
      // are selected and the tx size is known
      const changeOutputIndex = txBuilder.outputs.length
      txBuilder.addOutput({ to: cfg.fixedPrizePoolContract.tokenAddress, amount: DUST })

      // Input[2+]: fixed-prize-pool plain-BCH funding UTXOs, added largest-first until
      // refund + fee + dust is covered; fee computed from the tx's actual current size
      // (including placeholder-P2PKH correction)
      const candidates = await fetchFPPFundingUtxos()
      const fundingUtxos: Utxo[] = []
      let fppFundingTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 1)
      for (const u of candidates) {
        if (fppFundingTotal - refundSats - fee >= DUST) break
        if (fundingUtxos.length >= MAX_FUNDING_UTXOS) break
        txBuilder.addInput(toCsUtxo(u), cfg.fixedPrizePoolContract.unlock.spendPlainBCHForRefund())
        fundingUtxos.push(u)
        fppFundingTotal += u.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, 1)
      }

      if (fppFundingTotal - refundSats - fee < DUST) {
        throw new Error(
          fundingUtxos.length >= MAX_FUNDING_UTXOS
            ? `FixedPrizePool funding is too fragmented (needs more than ${MAX_FUNDING_UTXOS} UTXOs); please consolidate first`
            : `FixedPrizePool has insufficient funds (needs ${refundSats + fee + DUST} sats, has ${fppFundingTotal} sats)`
        )
      }

      const maxFee = CONTRACT_MAX_BASE_FEE + CONTRACT_MAX_PER_FUNDING_FEE * BigInt(fundingUtxos.length)
      if (fee > maxFee) throw new Error(`Computed fee (${fee} sats) exceeds contract limit (${maxFee} sats)`)

      txBuilder.outputs[changeOutputIndex].amount = fppFundingTotal - refundSats - fee

      const txHex = txBuilder.build()

      // ticket (0) is P2PKH; CR + funding inputs (1+) are contract-unlocked, not P2PKH
      const sourceOutputs = [
        toSourceOutput(ticketUtxo, playerLockHex),
        toSourceOutput(crUtxo, cfg.fixedPrizePoolContract.lockingBytecode),
        ...fundingUtxos.map(u => toSourceOutput(u, cfg.fixedPrizePoolContract.lockingBytecode)),
      ]

      // ticket input (index 0) uses receive[0] by convention; contract-unlocked inputs need no path
      const inputPaths: [number, string, number][] = [[0, 'receive', 0]]

      function applySuccess(txid: string) {
        state.txid = txid
        newTicketUtxo.value = {
          txid,
          vout: 0,
          valueSats: ticketUtxo.valueSats,
          token: { category: cfg.authNftCategoryId, nft: { capability: 'none', commitment: newTicketCommitment } },
        }
        state.status = 'success'
      }

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.claim_refund'))
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

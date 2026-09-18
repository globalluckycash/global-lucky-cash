import { reactive, ref } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchWNAtFPPForRound, fetchFPPFundingUtxos, broadcastTransaction } from '@/lib/electrum'
import { requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseTicketCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { TICKET_PRICE_USD_CENTS, usdCentsToSats } from '@/lib/pricing'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState, Utxo } from '@/types'

// Fixed-prize multiplier (multiple of ticket price, not an absolute USD amount)
const PRIZE_MULTIPLIER: Record<string, number> = { fixed4: 100, fixed3: 20, fixed2: 5, fixed1: 2 }
// claimStatus low-nibble prize-tier code, matching display order:
// 01=jackpot(claimJackpot) / 02=fixed4 / 03=fixed3 / 04=fixed2 / 05=fixed1
const PRIZE_TIER: Record<string, number> = { fixed1: 5, fixed2: 4, fixed3: 3, fixed4: 2 }
const DUST = 1000n
const FEE_RATE = 1
// Contract-side fee cap (FixedPrizePool.cash claimFixedPrize()'s maxFee)
const CONTRACT_MAX_BASE_FEE = 2000n
const CONTRACT_MAX_PER_FUNDING_FEE = 2200n
// Cap on funding UTXOs: each P2SH input carries a full redeem script, so too many bloat the
// tx — past this count the pool needs consolidating first
const MAX_FUNDING_UTXOS = 40

export interface ClaimFixedPrizeParams {
  ticketUtxo: Utxo
  round: number
  prizeLevel: 'fixed1' | 'fixed2' | 'fixed3' | 'fixed4'
}

export function useClaimFixedPrize() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  // Once broadcast, the new TicketNFT's content (output[0]) is already known, so the UI can
  // show the claimed status immediately without waiting for electrum re-indexing
  const newTicketUtxo = ref<Utxo | null>(null)

  async function execute(params: ClaimFixedPrizeParams): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null
    newTicketUtxo.value = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const playerAddress = walletStore.address
      if (!playerAddress) throw new NotConnectedError()

      const { ticketUtxo, round, prizeLevel } = params
      const ticket = parseTicketCommitment(ticketUtxo.token!.nft!.commitment)
      const prizeMultiplier = PRIZE_MULTIPLIER[prizeLevel]
      // purchaseRate is scaled ×100 (oracle ATTESTATION_SCALING), divide back out. prizeMultiplier
      // and TICKET_PRICE_USD_CENTS must be multiplied together before the single division,
      // matching contracts/FixedPrizePool.cash claimFixedPrize()'s totalPrizeSats formula exactly
      const prizeSats = usdCentsToSats(prizeMultiplier * TICKET_PRICE_USD_CENTS, ticket.purchaseRate)

      const wnUtxo = await fetchWNAtFPPForRound(round)
      if (!wnUtxo) throw new Error(`WinningNumber not found for round ${round}`)

      // claimStatus (byte 13, hex[26..27]): low nibble rewritten to the prize-tier code,
      // high nibble (existing flags) left unchanged
      const existingC = ticketUtxo.token!.nft!.commitment
      const existingClaimStatus = parseInt(existingC.slice(26, 28), 16)
      const newClaimStatus = (existingClaimStatus & 0xf0) | (PRIZE_TIER[prizeLevel] & 0x0f)
      const newTicketCommitment = existingC.slice(0, 26) + newClaimStatus.toString(16).padStart(2, '0') + existingC.slice(28)

      const playerLockHex = getLockingBytecodeHex(playerAddress)

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(ticketUtxo), placeholderP2PKHUnlocker(playerAddress))
      txBuilder.addInput(toCsUtxo(wnUtxo), cfg.fixedPrizePoolContract.unlock.claimFixedPrize())

      txBuilder.addOutput({
        to: playerAddress,
        amount: ticketUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment: newTicketCommitment } },
      })
      txBuilder.addOutput({
        to: cfg.fixedPrizePoolContract.tokenAddress,
        amount: wnUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: wnUtxo.token!.nft!.commitment } },
      })
      txBuilder.addOutput({ to: playerAddress, amount: prizeSats })

      // Output[3]: fixed-prize-pool change — placeholder amount, filled in once funding UTXOs
      // are selected and the tx size is known
      const changeOutputIndex = txBuilder.outputs.length
      txBuilder.addOutput({ to: cfg.fixedPrizePoolContract.tokenAddress, amount: DUST })

      // Input[2+]: fixed-prize-pool plain-BCH funding UTXOs, added largest-first until
      // prize + fee + dust is covered; fee computed from the tx's actual current size
      // (including placeholder-P2PKH correction)
      const candidates = await fetchFPPFundingUtxos()
      const fundingUtxos: Utxo[] = []
      let fppFundingTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 1)
      for (const u of candidates) {
        if (fppFundingTotal - prizeSats - fee >= DUST) break
        if (fundingUtxos.length >= MAX_FUNDING_UTXOS) break
        txBuilder.addInput(toCsUtxo(u), cfg.fixedPrizePoolContract.unlock.spendPlainBCH())
        fundingUtxos.push(u)
        fppFundingTotal += u.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, 1)
      }

      if (fppFundingTotal - prizeSats - fee < DUST) {
        throw new Error(
          fundingUtxos.length >= MAX_FUNDING_UTXOS
            ? `FixedPrizePool funding is too fragmented (needs more than ${MAX_FUNDING_UTXOS} UTXOs); please consolidate first`
            : `FixedPrizePool has insufficient funds (needs ${prizeSats + fee + DUST} sats, has ${fppFundingTotal} sats)`
        )
      }

      const maxFee = CONTRACT_MAX_BASE_FEE + CONTRACT_MAX_PER_FUNDING_FEE * BigInt(fundingUtxos.length)
      if (fee > maxFee) throw new Error(`Computed fee (${fee} sats) exceeds contract limit (${maxFee} sats)`)

      txBuilder.outputs[changeOutputIndex].amount = fppFundingTotal - prizeSats - fee

      const txHex = txBuilder.build()

      // ticket (0) is P2PKH; WN + funding inputs (1+) are contract-unlocked, not P2PKH
      const sourceOutputs = [
        toSourceOutput(ticketUtxo, playerLockHex),
        toSourceOutput(wnUtxo, cfg.fixedPrizePoolContract.lockingBytecode),
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
        const prizeLabel = i18n.global.t(`ticket.prize_${prizeLevel}`)
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.claim_fixed_prize', { prizeLabel }))
        applySuccess(await broadcastTransaction(signedTxHex))
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing; verify whether
        // the claimed TicketNFT commitment already appeared at the player's address.
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

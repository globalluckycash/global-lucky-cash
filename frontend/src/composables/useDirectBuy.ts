/**
 * useDirectBuy.ts — Wallet-free ticket purchase via TicketDeposit contract.
 *
 * Flow:
 *   1. Buyer selects numbers and enters their token-enabled z-address.
 *   2. computeDepositInfo() calculates the exact BCH amount to send and the
 *      deterministic TicketDeposit contract address.
 *   3. Buyer sends BCH from any wallet/exchange to the contract address.
 *   4. execute(info) verifies the deposit exists, then builds and broadcasts
 *      the buyTicket transaction — no wallet signature required.
 */

import { reactive } from 'vue'
import { TransactionBuilder } from 'cashscript'
import { decodeCashAddress } from '@bitauth/libauth'
import { provider, getConfig, getNumberSalesContract, getRoundShardAuthContract, createTicketDepositContract, estimateBuyTicketFeeSats, estimateRefundFeeSats } from '@/lib/contractConfig'
import { getAddressUtxos, fetchRandomRSAShard, fetchNSUtxo, getBchMTP } from '@/lib/electrum'
import { buildRSACommitment, buildNSCommitment, buildTicketCommitment, buildLotteryNumber, parseLotteryNumber } from '@/lib/nftDecode'
import { toCsUtxo } from '@/lib/txUtils'
import { leHex } from '@/lib/bytes'
import { ticketPriceSats } from '@/lib/pricing'
import { isUtxoRaceError, utxoRaceBackoffMs, sleep, friendlyBroadcastError, utxoRaceExhaustedError, MAX_UTXO_RACE_RETRIES } from '@/lib/broadcastRetry'

const DUST = 1000n
// Cushion added on top of the estimated fee (estimateBuyTicketFeeSats) so the deposit still
// clears the mandatory >=1000 sat change floor if the actual tx ends up slightly larger than
// the estimate.
const FEE_SAFETY_MARGIN = 1000n
// Deposit amount includes a fixed 10000 sat buffer on top of ticket price. execute() only
// requires the actual price (see minRequired below); the unused portion flows back via the
// change output at Output[2N+1].
const PRICE_BUFFER_SATS = 10_000n

const NETWORK = import.meta.env.VITE_NETWORK as 'mainnet' | 'chipnet'
const EXPECTED_PREFIX = NETWORK === 'mainnet' ? 'bitcoincash' : 'bchtest'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DepositInfo {
  depositAddress: string
  depositAmountSats: bigint
  depositAmountBch: string
  rate: number              // USD/BCH × 100 (ATTESTATION_SCALING), from the RSA shard's committed exchangeRate; used to compute depositAmountSats and for display
  round: number             // round committed to at deposit-creation time (part of the sha256 preimage)
  lotteryNumbers: string[]  // 8 hex chars each, 1..10 entries
  buyerAddress: string      // original z-address entered by user
  buyerPkh: Uint8Array      // 20-byte PKH decoded from address
}

export interface DirectBuyState {
  status: 'idle' | 'checking' | 'executing' | 'retrying' | 'success' | 'error'
  txid: string | null
  error: string | null
  /** 0 = not retrying; N = currently on automatic retry attempt N (see broadcastRetry.ts) */
  retryAttempt: number
}

// ─── Pure helpers (exported for use in UI) ────────────────────────────────────

/**
 * Validate that `address` is a token-enabled P2PKH address on the current network.
 * Returns the PKH bytes on success, or an error message.
 */
export function validateReceiverAddress(
  address: string,
): { valid: true; pkh: Uint8Array } | { valid: false; error: string } {
  const trimmed = address.trim()
  if (!trimmed) return { valid: false, error: '' }

  const result = decodeCashAddress(trimmed)
  if (typeof result === 'string') {
    return { valid: false, error: '無效的地址格式' }
  }
  if (result.prefix !== EXPECTED_PREFIX) {
    return { valid: false, error: `網路不符，需要 ${EXPECTED_PREFIX} 前綴的地址` }
  }
  if (result.type !== 'p2pkhWithTokens') {
    return { valid: false, error: '必須使用支援 Token 的地址（以 z 開頭）' }
  }
  return { valid: true, pkh: result.payload }
}

/**
 * Computes the deposit contract address and required BCH amount for one or more tickets.
 * `round` is baked into the deposit's sha256 commitment; buyTicket() rebuilds the preimage
 * on-chain from the actual RSA input's round at execute time, so if the round has advanced
 * the sha256 check fails and the tx is rejected (recoverable only via refund()).
 * `currentRate` must be the RSA shard's exchangeRate (USD/BCH × 100), not RSC's stagedRate:
 * exchangeRate is locked per round at settle() time, matching the minRequired check that
 * buildAndBroadcast() runs later.
 */
export function computeDepositInfo  (
  round: number,
  tickets: { n1: number; n2: number; n3: number; s: number }[],
  buyerAddress: string,
  buyerPkh: Uint8Array,
  currentRate: number,
): DepositInfo {
  if (tickets.length < 1 || tickets.length > 10) {
    throw new Error('Ticket quantity must be between 1 and 10')
  }
  const lotteryNumbers = tickets.map(({ n1, n2, n3, s }) => buildLotteryNumber(n1, n2, n3, s))
  const depositContract = createTicketDepositContract(round, lotteryNumbers, buyerPkh)
  // currentRate is scaled ×100 (oracle ATTESTATION_SCALING); divide back out.
  const ticketPrice = ticketPriceSats(currentRate)
  const totalCost = ticketPrice * BigInt(tickets.length)
  // Fixed 10000 sat fee buffer.
  const bufferedCost = totalCost + PRICE_BUFFER_SATS
  const estimatedFee = estimateBuyTicketFeeSats(tickets.length)
  const depositAmountSats = bufferedCost + DUST * BigInt(tickets.length) + estimatedFee + FEE_SAFETY_MARGIN
  return {
    depositAddress: depositContract.address,
    depositAmountSats,
    depositAmountBch: (Number(depositAmountSats) / 1e8).toFixed(8),
    rate: currentRate,
    round,
    lotteryNumbers,
    buyerAddress,
    buyerPkh,
  }
}

/**
 * Refunds a deposit back to the buyer's address. No wallet signature is required since
 * TicketDeposit.refund() only checks that Output[0] pays buyerPkh (contracts/TicketDeposit.cash).
 * Used to recover a deposit stuck after the round advanced past the one committed in
 * computeDepositInfo, since buyTicket()'s sha256 check is keyed to that round.
 */
export async function refundDeposit(info: DepositInfo): Promise<string> {
  const depositContract = createTicketDepositContract(info.round, info.lotteryNumbers, info.buyerPkh)

  const depositUtxos = await getAddressUtxos(depositContract.address)
  const depositUtxo = depositUtxos.find(u => !u.token)
  if (!depositUtxo) {
    throw new Error('找不到可退款的存款，請確認存款是否已到帳，或已被領取。')
  }

  const fee = estimateRefundFeeSats() + FEE_SAFETY_MARGIN
  const refundAmount = depositUtxo.valueSats - fee
  if (refundAmount < DUST) {
    throw new Error('存款金額扣除手續費後不足以退款（低於 dust 門檻）')
  }

  const txBuilder = new TransactionBuilder({ provider })
  txBuilder.addInput(toCsUtxo(depositUtxo), depositContract.unlock.refund())
  txBuilder.addOutput({ to: info.buyerAddress, amount: refundAmount })

  const rawTx = txBuilder.build()
  return provider.sendRawTransaction(rawTx)
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useDirectBuy() {
  const state = reactive<DirectBuyState>({
    status: 'idle',
    txid: null,
    error: null,
    retryAttempt: 0,
  })

  /**
   * Check deposit and broadcast the buyTicket transaction.
   * No wallet (Paytaca) is needed — all inputs are contract-based.
   */
  async function execute(info: DepositInfo): Promise<void> {
    state.status = 'checking'
    state.error = null
    state.txid = null
    state.retryAttempt = 0

    try {
      const cfg = getConfig()
      const depositContract = createTicketDepositContract(
        info.round, info.lotteryNumbers, info.buyerPkh,
      )

      // 1. Check deposit UTXO exists at the contract address
      const depositUtxos = await getAddressUtxos(depositContract.address)
      const depositUtxoOrNull = depositUtxos.find(u => !u.token)
      if (!depositUtxoOrNull) {
        throw new Error(
          '尚未偵測到存款。請確認已向合約地址存入 BCH，等待確認後再點擊「我已存款」。',
        )
      }
      // Reassigned to a non-undefined type so the buildAndBroadcast() closure below doesn't
      // see it as possibly undefined (narrowing doesn't persist across closures).
      const depositUtxo = depositUtxoOrNull

      const ticketQuantity = info.lotteryNumbers.length
      const numbers = info.lotteryNumbers.map(parseLotteryNumber)

      // Each lottery number has its own contract address (NumberSales.cash lotteryNumber constructor param)
      const nsContracts = info.lotteryNumbers.map(ln => getNumberSalesContract(ln))

      // 2-6. Fetch RSA shard (shared) + one NS UTXO per lottery number, build the tx, broadcast.
      // Re-fetches and rebuilds on every retry attempt rather than resending the previous tx.
      async function buildAndBroadcast(): Promise<string> {
        // 2. Fetch RSA shard (shared) and one NS UTXO per lottery number
        // info.round is the round locked into the TicketDeposit contract's sha256 commitment
        // at deposit-creation time; the preimage must be rebuilt with this same round, not the
        // current purchaseRound.
        const [rsaShard, ...nsUtxos] = await Promise.all([
          fetchRandomRSAShard(info.round),
          ...numbers.map(({ n1, n2, n3, s }) => fetchNSUtxo(n1, n2, n3, s)),
        ])
        // This shard's own contract address (RoundShardAuth.cash shardId constructor param)
        const rsaContract = getRoundShardAuthContract(leHex(rsaShard.shardState.shardId, 2))

        const rate = rsaShard.shardState.exchangeRate
        // rate is scaled ×100 (oracle ATTESTATION_SCALING); divide back out.
        const ticketPrice = ticketPriceSats(rate)
        const totalCost = ticketPrice * BigInt(ticketQuantity)

        // Last-sold-time ratchet: sellTicket() requires tx.time >= this field and rewrites it
        // to the new locktime, with at least one input's nSequence non-final for CashScript to
        // treat tx.time as valid. Fetches fresh MTP on every purchase rather than using
        // contractStore's cache.
        const now = await getBchMTP()
        const locktime = now > rsaShard.shardState.lastSoldTime ? now : rsaShard.shardState.lastSoldTime

        // 3. Validate deposit covers actual ticket price (rate may have changed)
        const minRequired = totalCost + DUST * BigInt(ticketQuantity) + estimateBuyTicketFeeSats(ticketQuantity) + FEE_SAFETY_MARGIN
        if (depositUtxo.valueSats < minRequired) {
          throw new Error(
            `存款金額不足（${Number(depositUtxo.valueSats) / 1e8} BCH）。` +
            `目前票價需要 ${Number(minRequired) / 1e8} BCH。` +
            `（匯率變動導致票價增加）`,
          )
        }

        // 4. Compute updated NFT commitments (one NS/Ticket commitment per lottery number)
        const isOddRound = rsaShard.shardState.sellingRound % 2 !== 0
        const newNSCommitments = nsUtxos.map(nsUtxo => {
          const newNSState = { ...nsUtxo.nsState }
          if (isOddRound) {
            if (nsUtxo.nsState.oddRound === rsaShard.shardState.sellingRound) {
              newNSState.oddCount = nsUtxo.nsState.oddCount + 1
            } else {
              newNSState.oddRound = rsaShard.shardState.sellingRound
              newNSState.oddCount = 1
            }
          } else {
            if (nsUtxo.nsState.evenRound === rsaShard.shardState.sellingRound) {
              newNSState.evenCount = nsUtxo.nsState.evenCount + 1
            } else {
              newNSState.evenRound = rsaShard.shardState.sellingRound
              newNSState.evenCount = 1
            }
          }
          return buildNSCommitment(newNSState)
        })

        const newRSACommitment = buildRSACommitment({
          ...rsaShard.shardState,
          shardSalesCount: rsaShard.shardState.shardSalesCount + ticketQuantity,
          lastSoldTime: locktime,
        })
        const ticketCommitments = numbers.map(({ n1, n2, n3, s }) => buildTicketCommitment({
          round: rsaShard.shardState.sellingRound,
          n1, n2, n3, s,
          claimStatus: 0,
          purchaseRate: rate,
        }))

        // 5. Build transaction (no P2PKH inputs — no wallet signature needed)
        const txBuilder = new TransactionBuilder({ provider })
        txBuilder.setLocktime(Number(locktime))

        // Input[0] = RSA NFT (sequence must be non-0xffffffff for the tx.time last-sold-time ratchet check to apply)
        txBuilder.addInput(
          toCsUtxo(rsaShard),
          rsaContract.unlock.sellTicket(),
          { sequence: 0xfffffffe },
        )
        // Input[1..N] = NS NFT × N (each lottery number has its own contract address)
        nsUtxos.forEach((nsUtxo, i) => {
          txBuilder.addInput(
            toCsUtxo(nsUtxo),
            nsContracts[i].unlock.sellTicket(),
          )
        })
        // Input[N+1] = TicketDeposit UTXO (covers ticket price × N + DUST × N + FEE_BUFFER)
        // buyTicket() takes no arguments — the preimage is reconstructed on-chain from
        // tx.inputs[0] (RSA round) and tx.inputs[1..N] (NumberSalesNFT lotteryNumber each)
        txBuilder.addInput(
          toCsUtxo(depositUtxo),
          depositContract.unlock.buyTicket(),
        )

        // Output[0] = RSA NFT (BCH += totalCost, sales count updated)
        txBuilder.addOutput({
          to: rsaContract.tokenAddress,
          amount: rsaShard.valueSats + totalCost,
          token: {
            category: cfg.authNftCategoryId,
            amount: 0n,
            nft: { capability: 'minting', commitment: newRSACommitment },
          },
        })
        // Output[1..N] = NS NFT × N (odd/even count updated)
        nsUtxos.forEach((nsUtxo, i) => {
          txBuilder.addOutput({
            to: nsContracts[i].tokenAddress,
            amount: nsUtxo.valueSats,
            token: {
              category: cfg.authNftCategoryId,
              amount: 0n,
              nft: { capability: 'mutable', commitment: newNSCommitments[i] },
            },
          })
        })
        // Output[N+1..2N] = TicketNFT × N minted to buyer's address
        // Contract verifies lockingBytecode == 0x76a914 + buyerPkh + 0x88ac
        // Both q-prefix and z-prefix (same PKH) produce identical P2PKH locking bytecode
        for (const commitment of ticketCommitments) {
          txBuilder.addOutput({
            to: info.buyerAddress,
            amount: DUST,
            token: {
              category: cfg.authNftCategoryId,
              amount: 0n,
              nft: { capability: 'none', commitment },
            },
          })
        }

        // Output[2N+1] = mandatory change output — all three covenants (RSA/NS/TicketDeposit)
        // require exactly 2N+2 outputs, with the last one paying >=1000 sats back to the buyer.
        // Fee is computed from the tx's actual byte size (getTransactionSize() via
        // addBchChangeOutputIfNeeded), since every input here is a fully-resolved covenant
        // unlock with no placeholder-unlocker padding.
        const outputsBeforeChange = txBuilder.outputs.length
        txBuilder.addBchChangeOutputIfNeeded({ to: info.buyerAddress, feeRate: 1 })
        const changeOutput = txBuilder.outputs[outputsBeforeChange]
        if (!changeOutput || changeOutput.amount < DUST) {
          throw new Error('存款餘額不足以支付找零（需至少 1000 sats）')
        }

        // 6. Broadcast (no private key needed — all inputs are contract-unlocked)
        const rawTx = txBuilder.build()
        return provider.sendRawTransaction(rawTx)
      }

      // RSA/NS UTXOs may be spent by another player first. On a rejected broadcast (missing
      // inputs / mempool conflict), refetch the latest UTXOs and rebuild the tx from scratch.
      // Exponential backoff: 1s→2s→4s→... capped at 100s, up to MAX_UTXO_RACE_RETRIES retries.
      for (let attempt = 0; ; attempt++) {
        state.status = 'executing'

        try {
          state.txid = await buildAndBroadcast()
          state.status = 'success'
          return
        } catch (err) {
          if (!isUtxoRaceError(err)) throw err
          if (attempt >= MAX_UTXO_RACE_RETRIES) throw utxoRaceExhaustedError()
          state.status = 'retrying'
          state.retryAttempt = attempt + 1
          state.error = friendlyBroadcastError(err)
          await sleep(utxoRaceBackoffMs(attempt + 1))
        }
      }

    } catch (err) {
      state.error = friendlyBroadcastError(err)
      state.status = 'error'
    }
  }

  /**
   * Refund a stuck deposit back to the buyer's address (see refundDeposit() above for when
   * this is needed). Reuses the same `state` as execute() so the modal's checking/executing/
   * success/error views work unchanged.
   */
  async function refund(info: DepositInfo): Promise<void> {
    state.status = 'executing'
    state.error = null
    state.txid = null
    state.retryAttempt = 0

    try {
      state.txid = await refundDeposit(info)
      state.status = 'success'
    } catch (err) {
      state.error = friendlyBroadcastError(err)
      state.status = 'error'
    }
  }

  function reset() {
    state.status = 'idle'
    state.txid = null
    state.error = null
    state.retryAttempt = 0
  }

  return { state, execute, refund, reset }
}

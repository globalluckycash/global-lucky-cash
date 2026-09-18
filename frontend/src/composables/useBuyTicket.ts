import { reactive } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getNumberSalesContract, getRoundShardAuthContract, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchRandomRSAShard, fetchNSUtxo, findUtxosByCommitment, broadcastTransaction, getBchMTP } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { buildRSACommitment, buildNSCommitment, buildTicketCommitment, buildLotteryNumber } from '@/lib/nftDecode'
import { leHex } from '@/lib/bytes'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { toCsUtxo, toSourceOutput, addBchChangeOutputForWc, estimateFeeForWc } from '@/lib/txUtils'
import { ticketPriceSats } from '@/lib/pricing'
import { isUtxoRaceError, utxoRaceBackoffMs, sleep, friendlyBroadcastError, utxoRaceExhaustedError, pollForNewCommitment, MAX_UTXO_RACE_RETRIES } from '@/lib/broadcastRetry'
import { savePendingSignature, clearPendingSignature } from '@/lib/pendingSignature'
import { i18n } from '@/i18n'
import type { TxState } from '@/types'

const DUST = 1000n
const FEE_RATE = 1
const MAX_TICKETS = 10 // On-chain limit: RoundShardAuth/NumberSales require ticketQuantity 1–10

export interface LotteryNumber {
  n1: number
  n2: number
  n3: number
  s: number
}

interface BuyTicketParams {
  tickets: LotteryNumber[]
}

export function useBuyTicket() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null, retryAttempt: 0 })

  async function execute(params: BuyTicketParams): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null
    state.retryAttempt = 0

    try {
      const { tickets } = params
      const ticketQuantity = tickets.length
      if (ticketQuantity < 1 || ticketQuantity > MAX_TICKETS) {
        throw new Error(`一次最多購買 ${MAX_TICKETS} 組號碼`)
      }

      const cfg = getConfig()
      const walletStore = useWalletStore()
      const contractStore = useContractStore()
      const playerAddress = walletStore.address
      if (!playerAddress) throw new NotConnectedError()

      // Each number combination has its own contract address (NumberSales.cash lotteryNumber constructor param)
      const nsContracts = tickets.map(({ n1, n2, n3, s }) => getNumberSalesContract(buildLotteryNumber(n1, n2, n3, s)))

      // RSA/NS UTXOs may be spent by another player first. On a rejected broadcast
      // (missing inputs / mempool conflict), refetch the latest UTXOs and rebuild the whole
      // tx, requesting a fresh wallet signature.
      async function buildSignAndBroadcast(): Promise<string> {
        const [rsaShard, nsUtxos, playerUtxos] = await Promise.all([
          fetchRandomRSAShard(contractStore.purchaseRound),
          Promise.all(tickets.map(({ n1, n2, n3, s }) => fetchNSUtxo(n1, n2, n3, s))),
          fetchPlayerUtxos(),
        ])
        if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))

        // The shard's own contract address (RoundShardAuth.cash shardId constructor param)
        const rsaContract = getRoundShardAuthContract(leHex(rsaShard.shardState.shardId, 2))

        const rate = rsaShard.shardState.exchangeRate
        // Scaled ×100 by the oracle (ATTESTATION_SCALING); must be divided back out
        const ticketPrice = ticketPriceSats(rate)
        const totalCost = ticketPrice * BigInt(ticketQuantity)

        // fetchPlayerUtxos() may return UTXOs from multiple addresses, so each selected fee UTXO's
        // real address is used for its placeholder unlocker/sourceOutput. RoundShardAuth.sellTicket()
        // ties its outputs (TicketNFTs, BCH change) to the first fee input's on-chain lockingBytecode,
        // and the loop below always selects starting from playerUtxos[0].
        const feeAddress = playerUtxos[0].address

        const isOddRound = rsaShard.shardState.sellingRound % 2 !== 0
        const newNSCommitments: string[] = []
        const ticketCommitments: string[] = []

        nsUtxos.forEach((nsUtxo, i) => {
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
          newNSCommitments.push(buildNSCommitment(newNSState))

          const { n1, n2, n3, s } = tickets[i]
          ticketCommitments.push(buildTicketCommitment({
            round: rsaShard.shardState.sellingRound,
            n1, n2, n3, s,
            claimStatus: 0,
            purchaseRate: rate,
          }))
        })

        // These two queries are independent, so fetch them in parallel. MTP is refetched fresh
        // for every purchase (not cached) to keep the RSA NFT's recorded last-sold time accurate.
        const [now, beforeUtxos] = await Promise.all([
          getBchMTP(),
          findUtxosByCommitment(feeAddress, cfg.authNftCategoryId, ticketCommitments[0]),
        ])

        // Last-sold-time ratchet: sellTicket() requires tx.time >= this field and rewrites it to
        // the new locktime, which must fall within [previous last-sold time, real MTP], with at
        // least one input's nSequence non-final for CashScript to treat tx.time as valid.
        const locktime = now > rsaShard.shardState.lastSoldTime ? now : rsaShard.shardState.lastSoldTime

        const newRSACommitment = buildRSACommitment({
          ...rsaShard.shardState,
          shardSalesCount: rsaShard.shardState.shardSalesCount + ticketQuantity,
          lastSoldTime: locktime,
        })

        // Buying the same number combination again in the same round at the same rate produces
        // an identical commitment, so existence alone can't tell an old ticket from the new one.
        // Record which matching UTXOs already exist at feeAddress before signing (beforeKeys),
        // then later check for one not in that set.
        const beforeKeys = beforeUtxos.map(u => `${u.txid}:${u.vout}`)

        const txBuilder = new TransactionBuilder({ provider })
        txBuilder.setLocktime(Number(locktime))
        txBuilder.addInput(toCsUtxo(rsaShard), rsaContract.unlock.sellTicket(), { sequence: 0xfffffffe })
        nsUtxos.forEach((nsUtxo, i) => {
          txBuilder.addInput(toCsUtxo(nsUtxo), nsContracts[i].unlock.sellTicket())
        })

        txBuilder.addOutput({
          to: rsaContract.tokenAddress,
          amount: rsaShard.valueSats + totalCost,
          token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newRSACommitment } },
        })
        nsUtxos.forEach((nsUtxo, i) => {
          txBuilder.addOutput({
            to: nsContracts[i].tokenAddress,
            amount: nsUtxo.valueSats,
            token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'mutable', commitment: newNSCommitments[i] } },
          })
        })
        ticketCommitments.forEach(commitment => {
          txBuilder.addOutput({
            to: feeAddress,
            amount: DUST,
            token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment } },
          })
        })

        // Input[N+1+]: player plain BCH, added one at a time until ticket cost + NFT dust +
        // change dust is covered. Fee is computed from the tx's actual current size (including
        // placeholder-P2PKH correction) rather than a fixed margin guess.
        const requiredExtra = totalCost + DUST * BigInt(ticketQuantity)
        const selectedPlayerUtxos: typeof playerUtxos = []
        let payTotal = 0n
        let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
        let surplus = payTotal - requiredExtra - fee
        for (const pu of playerUtxos) {
          if (surplus >= DUST) break
          txBuilder.addInput(toCsUtxo(pu.utxo), placeholderP2PKHUnlocker(pu.address))
          selectedPlayerUtxos.push(pu)
          payTotal += pu.utxo.valueSats
          fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedPlayerUtxos.length)
          surplus = payTotal - requiredExtra - fee
        }
        if (surplus < DUST) {
          throw new Error(i18n.global.t('toast.insufficient_balance'))
        }
        const playerUtxoAddresses = selectedPlayerUtxos.map(pu => pu.address)

        addBchChangeOutputForWc(txBuilder, { to: feeAddress, feeRate: FEE_RATE }, selectedPlayerUtxos.length)

        const txHex = txBuilder.build()

        // Contract inputs: RSA (0), NS (1..N); player inputs start at N+1
        const contractInputCount = 1 + ticketQuantity
        const sourceOutputs = [
          toSourceOutput(rsaShard, rsaContract.lockingBytecode),
          ...nsUtxos.map((nsUtxo, i) => toSourceOutput(nsUtxo, nsContracts[i].lockingBytecode)),
          ...selectedPlayerUtxos.map((pu, i) => toSourceOutput(pu.utxo, getLockingBytecodeHex(playerUtxoAddresses[i]))),
        ]
        const inputPaths = selectedPlayerUtxos.map((pu, i) => [
          contractInputCount + i,
          pu.pathName,
          pu.addressIndex,
        ] as [number, string, number])

        // If the tab is fully evicted by the system (not just backgrounded), App.vue's
        // reconcilePendingSignature() uses this saved record to reconcile the result on-chain
        // at next launch, without relying on the WalletConnect response or the tab surviving.
        savePendingSignature({
          address: feeAddress,
          category: cfg.authNftCategoryId,
          commitment: ticketCommitments[0],
          beforeKeys,
          createdAt: Date.now(),
        })

        state.status = 'awaiting_signature'
        try {
          const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.buy_ticket', { n: ticketQuantity }))
          return broadcastTransaction(signedTxHex)
        } catch (err) {
          if (!(err instanceof SignatureConnectionLostError)) throw err
          // Connection may drop while switching to the wallet app for signing; verify whether a
          // new TicketNFT UTXO (not in beforeKeys) has appeared for the first ticket — checking
          // one is enough since a BCH tx is all-or-nothing.
          state.status = 'verifying'
          const recovered = await pollForNewCommitment(feeAddress, cfg.authNftCategoryId, ticketCommitments[0], beforeKeys)
          if (recovered) return recovered.txid
          throw new Error(i18n.global.t('errors.wallet_result_unknown'))
        }
      }

      // Exponential backoff: 1s→2s→4s→... capped at 100s, up to MAX_UTXO_RACE_RETRIES retries
      for (let attempt = 0; ; attempt++) {
        state.status = 'building'

        try {
          state.txid = await buildSignAndBroadcast()
          clearPendingSignature()
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
      // Reaching here means the operation has a definite outcome (rejected, retries exhausted,
      // or verified as failed), so the persisted record is no longer needed.
      clearPendingSignature()
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

  return { state, execute, reset }
}

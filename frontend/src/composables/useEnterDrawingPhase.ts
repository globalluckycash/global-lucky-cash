import { reactive, computed } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import {
  fetchRSCUtxo, fetchJackpotPoolUtxo, fetchConfigUtxo, broadcastTransaction,
} from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseRSCCommitment, buildRSCCommitment, buildDrawingNftCommitment, parseJPCommitment, buildJPCommitment, parseConfigCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { toCsUtxo, toSourceOutput, addBchChangeOutputForWc, estimateFeeForWc } from '@/lib/txUtils'
import { oneUsdSats, ticketPriceSats } from '@/lib/pricing'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState } from '@/types'

const DUST = 1000n
const FEE_RATE = 1
const DRAW_DELAY = 10800n        // 3 hours in seconds
// Must match contracts/RoundSwitchControl.cash enterDrawingPhase() / RoundShardAuth.cash
// useForAggregate()
const SETTLE_FEE_RESERVE = 6000n
const SETTLE_REWARD_DIVISOR = 64n // Always divided by the total shard count (shardCount)

export function useEnterDrawingPhase() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  const contractStore = useContractStore()

  // Ready once this round has been aggregated (RSC.lastAggregateTime != 0, written by aggregate())
  const isReady = computed(() => contractStore.aggregated)

  async function execute(): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const operatorAddress = walletStore.address
      if (!operatorAddress) throw new NotConnectedError()

      const [rscUtxo, jackpotUtxo, configUtxo, playerUtxos] = await Promise.all([
        fetchRSCUtxo(),
        fetchJackpotPoolUtxo(),
        fetchConfigUtxo(),
        fetchPlayerUtxos(),
      ])

      const rscState = parseRSCCommitment(rscUtxo.token!.nft!.commitment)
      const jpCapability = jackpotUtxo.token!.nft!.capability
      const jpState = parseJPCommitment(jackpotUtxo.token!.nft!.commitment)
      const cfgState = parseConfigCommitment(configUtxo.token!.nft!.commitment)

      // JP receives 50% and FPP 30% of this round's gross ticket revenue (ticketPriceSats ×
      // cumulativeSales); PlatformPool absorbs the rest, including aggregate()'s operating
      // costs. Matches contracts/RoundSwitchControl.cash enterDrawingPhase().
      // stagedRate is scaled x100 by the oracle (ATTESTATION_SCALING); divided back out here.
      const executeShare = oneUsdSats(rscState.stagedRate)
      const reserve = executeShare * 3n

      // Reserves next round's two aggregate() execute rewards (0.5 USD each, 1 USD total) plus
      // the execute-reward prefund for all 64 settle() calls next round
      const aggregateReserve = executeShare
      const perShardSettle = (executeShare - (executeShare % SETTLE_REWARD_DIVISOR)) / SETTLE_REWARD_DIVISOR
      const settleRefillReserve = (SETTLE_FEE_RESERVE + perShardSettle) * SETTLE_REWARD_DIVISOR
      const newRscValue = DUST + aggregateReserve + settleRefillReserve

      // grossRevenue uses ConfigNFT.settledRate (this round's actual sale rate, written by
      // aggregate()), not rscState.stagedRate (the latest known rate, a different generation).
      const grossRevenue = ticketPriceSats(cfgState.settledRate) * rscState.cumulativeSales
      let jackpotShare = grossRevenue * 50n / 100n
      let fixedShare = grossRevenue * 30n / 100n

      // Floor JP/FPP at dust when this round sold zero or very few tickets, matching
      // RoundSwitchControl.cash's `if (fixedShare < 1000) fixedShare = 1000` /
      // `if (jackpotShare < 1000) jackpotShare = 1000`
      if (fixedShare < DUST) fixedShare = DUST
      if (jackpotShare < DUST) jackpotShare = DUST

      const totalBCH = rscUtxo.valueSats - DUST // Subtract RSC's own continuation dust; this is the balance after aggregate()'s deductions
      const drawingNftValue = DUST + reserve

      // platformShare = remaining balance after jackpotShare, fixedShare, this tx's own execute
      // reward, next round's aggregate()/settle() reserves, and DrawingNFT dust; floored at
      // dust, matching RoundSwitchControl.cash's `if (platformShare < 1000) platformShare = 1000`
      let platformShare = totalBCH - jackpotShare - fixedShare - executeShare - reserve - aggregateReserve - settleRefillReserve - DUST
      if (platformShare < DUST) platformShare = DUST

      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))
      // fetchPlayerUtxos() may scan multiple addresses. Contract checks tying an output back to
      // a specific input's on-chain lockingBytecode only reference the *first* fee input, so
      // that one's address (always selected first by the loop below) is used for outputs.
      const feeAddress = playerUtxos[0].address

      // cutoffTime is recomputed from ConfigNFT (genesisTime + newRound * roundPeriod), matching
      // RoundSwitchControl.cash's enterDrawingPhase(); lastAggregateTime reset to 0 (two-state
      // field, 0 = not yet aggregated this round).
      const newRound = rscState.drawingRound + 1
      const newCutoffTime = cfgState.genesisTime + BigInt(newRound) * BigInt(cfgState.roundPeriod)
      const newRscState = {
        ...rscState,
        drawingRound: newRound,
        cutoffTime: newCutoffTime,
        cumulativeSales: 0n,
        lastAggregateTime: 0n,
      }
      const newRSCCommitment = buildRSCCommitment(newRscState)
      const newDrawingState = {
        round: rscState.drawingRound,
        // expectedDrawTime = lastAggregateTime + 3 hours; lastAggregateTime holds the actual
        // time of this round's last ticket sale, aggregated across all 64 shards.
        expectedDrawTime: rscState.lastAggregateTime + DRAW_DELAY,
        cumulativeSales: rscState.cumulativeSales,
      }
      const drawingCommitment = buildDrawingNftCommitment(newDrawingState)

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(jackpotUtxo), cfg.jackpotPoolContract.unlock.enterDrawingPhase())
      txBuilder.addInput(toCsUtxo(rscUtxo), cfg.roundSwitchControlContract.unlock.enterDrawingPhase())
      // Input[2]: ConfigNFT（none capability，purpose 0x06）— required by the contract's
      // useConfig() so activeInputIndex == 2; supplies genesisTime/roundPeriod to recompute
      // newCutoffTime above, and must be passed through unchanged as Output[6] below.
      txBuilder.addInput(toCsUtxo(configUtxo), cfg.roundSwitchControlContract.unlock.useConfig())

      // Output[0]: FixedPrizePool (plain BCH, no NFT)
      txBuilder.addOutput({ to: cfg.fixedPrizePoolContract.address, amount: fixedShare })
      // Output[1]: PlatformPool (remaining share after absorbing operating costs, computed above)
      txBuilder.addOutput({ to: cfg.platformPoolContract.address, amount: platformShare })
      // Output[2]: JackpotPoolNFT (commitment updates totalBCH, BCH += jackpotShare)
      const newJackpotTotal = jackpotUtxo.valueSats + jackpotShare
      const newJpState = { ...jpState, totalBCH: newJackpotTotal }
      const newJpCommitment = buildJPCommitment(newJpState)
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: newJackpotTotal,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: jpCapability, commitment: newJpCommitment } },
      })
      // Output[3]: RSC NFT (round+1, BCH = dust + aggregateReserve + settleRefillReserve)
      txBuilder.addOutput({
        to: cfg.roundSwitchControlContract.tokenAddress,
        amount: newRscValue,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newRSCCommitment } },
      })
      // Output[4]: DrawingNFT (newly minted, value = dust + fixed 3 USD reserve as the reward buffer pool)
      txBuilder.addOutput({
        to: cfg.drawingContract.tokenAddress,
        amount: drawingNftValue,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: drawingCommitment } },
      })
      // Output[5]: execute reward address (plain BCH, exactly 1 USD, separate from change)
      const requiredReward = executeShare
      txBuilder.addOutput({ to: feeAddress, amount: requiredReward })
      // Output[6]: ConfigNFT (passed through unchanged, commitment unchanged)
      txBuilder.addOutput({
        to: cfg.roundSwitchControlContract.tokenAddress,
        amount: configUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment: configUtxo.token!.nft!.commitment } },
      })
      // Input[3+]: player plain BCH, added one at a time until fee + change dust is covered.
      // Fee is computed from the tx's actual current size (including placeholder-P2PKH
      // correction) rather than a fixed margin guess, since the contract enforces exactly 8
      // outputs.
      const covenantInTotal = jackpotUtxo.valueSats + rscUtxo.valueSats + configUtxo.valueSats
      const totalOutOthers = fixedShare + platformShare + newJackpotTotal + newRscValue + drawingNftValue +
        requiredReward + configUtxo.valueSats

      const selectedPlayerUtxos: typeof playerUtxos = []
      let payTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
      let surplus = covenantInTotal - totalOutOthers - fee
      for (const pu of playerUtxos) {
        if (surplus >= DUST) break
        txBuilder.addInput(toCsUtxo(pu.utxo), placeholderP2PKHUnlocker(pu.address))
        selectedPlayerUtxos.push(pu)
        payTotal += pu.utxo.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedPlayerUtxos.length)
        surplus = covenantInTotal + payTotal - totalOutOthers - fee
      }
      if (surplus < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }
      const playerUtxoAddresses = selectedPlayerUtxos.map(pu => pu.address)

      // Output[7]: BCH change (separate from the execute reward; contract enforces tx.outputs.length == 8)
      addBchChangeOutputForWc(txBuilder, { to: feeAddress, feeRate: FEE_RATE }, selectedPlayerUtxos.length)

      const txHex = txBuilder.build()

      // Contract inputs: jackpot(0), rsc(1), config(2); fee inputs start at 3
      const contractInputCount = 3
      const sourceOutputs = [
        toSourceOutput(jackpotUtxo, cfg.jackpotPoolContract.lockingBytecode),
        toSourceOutput(rscUtxo, cfg.roundSwitchControlContract.lockingBytecode),
        toSourceOutput(configUtxo, cfg.roundSwitchControlContract.lockingBytecode),
        ...selectedPlayerUtxos.map((pu, i) => toSourceOutput(pu.utxo, getLockingBytecodeHex(playerUtxoAddresses[i]))),
      ]
      const inputPaths = selectedPlayerUtxos.map((pu, i) => [
        contractInputCount + i,
        pu.pathName,
        pu.addressIndex,
      ] as [number, string, number])

      // Optimistically update contractStore on broadcast success, without waiting for electrum
      // re-indexing; contractStore.jackpotSats already excludes the 1000-sat protocol dust, so
      // subtract it here too.
      function applySuccess(txid: string) {
        state.txid = txid
        contractStore.applyEnterDrawingPhase(newRscState, newRscValue, newDrawingState, newJpState, newJackpotTotal - DUST)
        state.status = 'success'
      }

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.enter_draw'))
        applySuccess(await broadcastTransaction(signedTxHex))
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing; verify whether the
        // new round's RSC commitment already appeared at the contract's own address.
        state.status = 'verifying'
        const recovered = await pollForCommitment(cfg.roundSwitchControlContract.tokenAddress, cfg.authNftCategoryId, newRSCCommitment)
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
  }

  return { state, isReady, execute, reset }
}

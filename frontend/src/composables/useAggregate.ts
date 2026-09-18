import { reactive, computed } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getRoundShardAuthContract, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchRSCUtxo, fetchConfigUtxo, fetchAggregateReadySSUtxos, broadcastTransaction } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseRSCCommitment, parseConfigCommitment, buildRSCCommitment, buildSSCommitment, buildConfigCommitment } from '@/lib/nftDecode'
import type { RSCNftState, ConfigNftState } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { leHex } from '@/lib/bytes'
import { oneUsdSats } from '@/lib/pricing'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState } from '@/types'
import type { SsShardUtxo, Utxo } from '@/types'

const DUST = 1000n
const FEE_RATE = 1
// Must match contracts/RoundShardAuth.cash useForAggregate() and RoundSwitchControl.cash aggregate()
const SETTLE_FEE_RESERVE = 6000n
const SETTLE_REWARD_DIVISOR = 64n // Always divided by total shard count, regardless of batch size
const AGGREGATE_FEE_RESERVE = 90000n // Matches aggregateFeeReserve in contracts/RoundSwitchControl.cash aggregate()
const BATCH_SIZE = 32 // Fixed shards per batch; must evenly divide shardCount

export function useAggregate() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  const contractStore = useContractStore()

  // Ready once every shard is settled (settledShardCount === shardCount) and this round hasn't
  // been aggregated yet; stays true between the first and second batch
  const isReady = computed(() => contractStore.aggregateReady && !contractStore.aggregated)

  // Aggregation progress, for the UI's batch-completion badge
  const batchTotal = computed(() => Math.ceil((contractStore.configState?.shardCount ?? 0) / BATCH_SIZE))
  const batchDone = computed(() => contractStore.aggregateBatchInProgress ? 1 : 0)

  /**
   * Aggregates settled ShardSettlementNFTs in two batches of 32 (contracts/RoundSwitchControl.cash
   * aggregate()) — a single 64-shard batch would exceed BCH's 100,000-byte tx-size limit. Reads
   * RSC's current aggregateBatchFlag to decide whether one or both batches remain, running all
   * of them within one execute() call. No player signature is needed between batches.
   */
  async function execute(): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const operatorAddress = walletStore.address
      if (!operatorAddress) throw new NotConnectedError()

      let [rscUtxo, configUtxo] = await Promise.all([fetchRSCUtxo(), fetchConfigUtxo()])
      let rscState = parseRSCCommitment(rscUtxo.token!.nft!.commitment)
      const cfgState = parseConfigCommitment(configUtxo.token!.nft!.commitment)

      // Expected shard count tracks progress: all shardCount shards when aggregateBatchFlag===0
      // (not started), or the remaining 32 when aggregateBatchFlag===1 (first batch done)
      const ssUtxos = await fetchAggregateReadySSUtxos(rscState.drawingRound)
      const expectedCount = rscState.aggregateBatchFlag === 0 ? cfgState.shardCount : BATCH_SIZE
      if (ssUtxos.length !== expectedCount) {
        if (rscState.aggregateBatchFlag === 0) {
          throw new Error(
            `尚有分片未完成結算：${ssUtxos.length}/${cfgState.shardCount} 張 ShardSettlementNFT 已達待彙整狀態`
          )
        }
        throw new Error(
          `第一批彙整已完成，但剩餘待彙整分片數異常：${ssUtxos.length}/${BATCH_SIZE}，請重新整理後再試`
        )
      }
      // Sort by shardId for a stable tx structure
      ssUtxos.sort((a, b) => a.ssState.shardId - b.ssState.shardId)

      let lastTxid = ''
      let finalRscState: RSCNftState = rscState
      let finalRscValueSats = 0n

      if (rscState.aggregateBatchFlag === 0) {
        const batchA = ssUtxos.slice(0, BATCH_SIZE)
        const batchB = ssUtxos.slice(BATCH_SIZE)

        const resultA = await runOneBatch(cfg, operatorAddress, rscUtxo, configUtxo, batchA, rscState, cfgState, state)
        lastTxid = resultA.txid
        rscUtxo = resultA.newRscUtxo
        configUtxo = resultA.newConfigUtxo
        rscState = resultA.newRscState

        const resultB = await runOneBatch(cfg, operatorAddress, rscUtxo, configUtxo, batchB, rscState, cfgState, state)
        lastTxid = resultB.txid
        finalRscState = resultB.newRscState
        finalRscValueSats = resultB.newRscValueSats
      } else {
        const resultB = await runOneBatch(cfg, operatorAddress, rscUtxo, configUtxo, ssUtxos, rscState, cfgState, state)
        lastTxid = resultB.txid
        finalRscState = resultB.newRscState
        finalRscValueSats = resultB.newRscValueSats
      }

      state.txid = lastTxid
      // Optimistically update contractStore on broadcast success, without waiting for electrum re-indexing
      contractStore.applyAggregate(finalRscState, finalRscValueSats)
      state.status = 'success'
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

  return { state, isReady, execute, reset, batchDone, batchTotal }
}

/**
 * Builds and broadcasts one aggregate() batch (32 shards), returning the resulting RSC/Config
 * UTXOs so the caller can chain the next batch without re-querying the provider.
 */
async function runOneBatch(
  cfg: ReturnType<typeof getConfig>,
  operatorAddress: string,
  rscUtxo: Utxo,
  configUtxo: Utxo,
  batchSsUtxos: SsShardUtxo[],
  rscState: RSCNftState,
  cfgState: ConfigNftState,
  state: TxState
): Promise<{ txid: string; newRscUtxo: Utxo; newConfigUtxo: Utxo; newRscState: RSCNftState; newRscValueSats: bigint }> {
  state.status = 'building'

  // Sum this batch's ticket sales, BCH, and latest sale time
  let batchSettledSales = 0
  let batchSettledBch = 0n
  // Floor at the greater of the previous lastAggregateTime and genesisTime
  let maxLastSoldTime = rscState.lastAggregateTime > cfgState.genesisTime ? rscState.lastAggregateTime : cfgState.genesisTime
  for (const u of batchSsUtxos) {
    batchSettledSales += u.ssState.shardSalesCount
    batchSettledBch += u.valueSats
    if (u.ssState.lastSoldTime > maxLastSoldTime) maxLastSoldTime = u.ssState.lastSoldTime
  }

  const isSecondBatch = rscState.aggregateBatchFlag === 1

  // All 32 shards' nextSellingRate (thisNFTRate during phase=0x01, written by settle()) should
  // match; take the first shard's value, consistent with the contract's useConfigForAggregate()
  const settledRate = batchSsUtxos[0].ssState.nextSellingRate
  const newConfigCommitment = buildConfigCommitment({
    genesisTime: cfgState.genesisTime,
    roundPeriod: cfgState.roundPeriod,
    shardCount: cfgState.shardCount,
    settledRate,
  })

  // cumulativeSales/lastAggregateTime accumulate this batch's contribution onto the existing
  // value; gameOverFlag passes through unchanged; aggregateBatchFlag is set to 1 after the
  // first batch and back to 0 after the second
  const newRscState: RSCNftState = {
    ...rscState,
    cumulativeSales: rscState.cumulativeSales + BigInt(batchSettledSales),
    lastAggregateTime: maxLastSoldTime,
    aggregateBatchFlag: isSecondBatch ? 0 : 1,
  }
  const newRscCommitment = buildRSCCommitment(newRscState)

  // Fresh SS parameters for the next settlement round (round + 2)
  const newSsRound = rscState.drawingRound + 2
  const newSsCutoffTime = cfgState.genesisTime + BigInt(rscState.drawingRound + 1) * BigInt(cfgState.roundPeriod)
  const newSsCommitments = batchSsUtxos.map(u => buildSSCommitment({
    phase: 0,
    round: newSsRound,
    shardId: u.ssState.shardId,
    nextSellingRate: rscState.stagedRate,
    sellingCutoffTime: newSsCutoffTime,
    shardSalesCount: 0,
    lastSoldTime: 0n,
    gameOverFlag: rscState.gameOverFlag,
  }))

  // Pre-fund settle()'s fee/execute reward (divisor is always the total shard count, not this
  // batch's size), plus this tx's own execute reward: a fixed 0.5 USD per batch
  const usdSats = oneUsdSats(rscState.stagedRate)
  const perShardSettle = (usdSats - (usdSats % SETTLE_REWARD_DIVISOR)) / SETTLE_REWARD_DIVISOR
  const settlePoolTotal = (SETTLE_FEE_RESERVE + perShardSettle) * BigInt(batchSsUtxos.length)
  const newSsValue = DUST + SETTLE_FEE_RESERVE + perShardSettle

  const roundRevenueSats = batchSettledBch - DUST * BigInt(batchSsUtxos.length)
  const ownReward = usdSats / 2n

  // Output[0]: RSC NFT — deduct aggregateFeeReserve (this tx's own miner fee) + 1000 (dust for
  // the Output[34] reward output); floor at 1000
  let rscBchOut = rscUtxo.valueSats + roundRevenueSats - settlePoolTotal - ownReward - AGGREGATE_FEE_RESERVE - DUST
  if (rscBchOut < DUST) rscBchOut = DUST

  // Output[34]'s pool before fee: total inputs minus Output[0..33], not the "ownReward+1000"
  // shortcut (invalid once rscBchOut is clamped to its floor; see scripts/aggregate.ts)
  const totalInBeforeEscape = rscUtxo.valueSats + batchSettledBch + configUtxo.valueSats
  const mandatoryOutBeforeReward = rscBchOut + newSsValue * BigInt(batchSsUtxos.length) + configUtxo.valueSats
  const rewardPoolBeforeFee = totalInBeforeEscape - mandatoryOutBeforeReward

  const playerUtxos = await fetchPlayerUtxos()

  const txBuilder = new TransactionBuilder({ provider })

  // Input[0]: RSC NFT
  txBuilder.addInput(toCsUtxo(rscUtxo), cfg.roundSwitchControlContract.unlock.aggregate())
  // Input[1..32]: ShardSettlementNFT × 32, each at its own shard address
  for (const u of batchSsUtxos) {
    const shardContract = getRoundShardAuthContract(leHex(u.ssState.shardId, 2))
    txBuilder.addInput(toCsUtxo(u), shardContract.unlock.useForAggregate())
  }
  // Input[33]: ConfigNFT
  txBuilder.addInput(toCsUtxo(configUtxo), cfg.roundSwitchControlContract.unlock.useConfigForAggregate())

  // Output[0]: RSC NFT
  txBuilder.addOutput({
    to: cfg.roundSwitchControlContract.tokenAddress,
    amount: rscBchOut,
    token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newRscCommitment } },
  })
  // Output[1..32]: ShardSettlementNFT × 32, reset to pending-settlement state at their own
  // addresses; BCH value = dust + settle()'s fee reserve + next settle() execute-reward prefund
  batchSsUtxos.forEach((u, i) => {
    txBuilder.addOutput({
      to: getRoundShardAuthContract(leHex(u.ssState.shardId, 2)).tokenAddress,
      amount: newSsValue,
      token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newSsCommitments[i] } },
    })
  })
  // Output[33]: ConfigNFT — genesisTime/roundPeriod/shardCount unchanged, settledRate rewritten
  // to this batch's verified value (burn-and-remint under 'none' capability, authorized by
  // RSC's minting capability)
  txBuilder.addOutput({
    to: cfg.roundSwitchControlContract.tokenAddress,
    amount: configUtxo.valueSats,
    token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment: newConfigCommitment } },
  })

  // Output[34]: execute reward, to the triggerer's own address (contract doesn't validate the
  // destination); placeholder amount, filled in once the fee is computed
  txBuilder.addOutput({ to: operatorAddress, amount: DUST + ownReward })

  let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
  let reward = rewardPoolBeforeFee - fee

  // Input[34]: escape hatch — the RSC-side reserve only covers 1000+ownReward, not this tx's own
  // miner fee, so this is almost always needed (a clamped rscBchOut widens the gap further).
  // The contract caps tx.inputs.length at 34 or 35, so only a single plain-BCH UTXO large enough
  // to cover the gap can be added
  const selectedPlayerUtxos: typeof playerUtxos = []
  if (reward < DUST + ownReward) {
    const shortfall = DUST + ownReward - reward
    const escapePu = [...playerUtxos].sort((a, b) => (a.utxo.valueSats < b.utxo.valueSats ? -1 : 1))
      .find(pu => pu.utxo.valueSats >= shortfall)
    if (!escapePu) {
      throw new Error(
        `觸發者資金不足：逃生閥需要單一顆 >= ${shortfall} sats 的 plain BCH UTXO 補足下限，找不到符合的 UTXO`
      )
    }
    txBuilder.addInput(toCsUtxo(escapePu.utxo), placeholderP2PKHUnlocker(escapePu.address))
    selectedPlayerUtxos.push(escapePu)
    fee = estimateFeeForWc(txBuilder, FEE_RATE, 1)
    reward = rewardPoolBeforeFee + escapePu.utxo.valueSats - fee
    if (reward < DUST + ownReward) {
      throw new Error(`逃生閥 UTXO 仍不足付手續費：缺口 ${DUST + ownReward - reward} sats`)
    }
  }
  txBuilder.outputs[txBuilder.outputs.length - 1].amount = reward

  const txHex = txBuilder.build()

  let txid: string
  // aggregate() has no checkSig(); Input[0..33] are all contract-unlocked and need no player
  // signature. Only the escape-hatch input (Input[34], plain BCH) needs wallet signing — when
  // selectedPlayerUtxos is empty, txBuilder.build() already produces the final, broadcastable tx
  if (selectedPlayerUtxos.length === 0) {
    txid = await broadcastTransaction(txHex)
  } else {
    // Contract inputs: RSC(0) + SS(1..32) + Config(33); operator inputs start at 34
    const contractInputCount = 1 + batchSsUtxos.length + 1
    const sourceOutputs = [
      toSourceOutput(rscUtxo, cfg.roundSwitchControlContract.lockingBytecode),
      ...batchSsUtxos.map(u => toSourceOutput(u, getRoundShardAuthContract(leHex(u.ssState.shardId, 2)).lockingBytecode)),
      toSourceOutput(configUtxo, cfg.roundSwitchControlContract.lockingBytecode),
      ...selectedPlayerUtxos.map(pu => toSourceOutput(pu.utxo, getLockingBytecodeHex(pu.address))),
    ]
    const inputPaths = selectedPlayerUtxos.map((pu, i) => [
      contractInputCount + i,
      pu.pathName,
      pu.addressIndex,
    ] as [number, string, number])

    state.status = 'awaiting_signature'
    try {
      const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.aggregate'))
      txid = await broadcastTransaction(signedTxHex)
    } catch (err) {
      if (!(err instanceof SignatureConnectionLostError)) throw err
      // Connection may drop while switching to the wallet app for signing; verify whether the
      // updated RSC commitment already landed at the contract's own address
      state.status = 'verifying'
      const recovered = await pollForCommitment(cfg.roundSwitchControlContract.tokenAddress, cfg.authNftCategoryId, newRscCommitment)
      if (!recovered) throw new Error(i18n.global.t('errors.wallet_result_unknown'))
      txid = recovered.txid
    }
  }

  // Build the next batch's UTXOs directly from the just-broadcast tx, without re-querying the
  // provider
  const newRscUtxo = {
    txid,
    vout: 0,
    valueSats: rscBchOut,
    token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting' as const, commitment: newRscCommitment } },
  } as Utxo
  const newConfigUtxo = {
    txid,
    vout: 1 + batchSsUtxos.length,
    valueSats: configUtxo.valueSats,
    token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none' as const, commitment: newConfigCommitment } },
  } as Utxo

  return { txid, newRscUtxo, newConfigUtxo, newRscState, newRscValueSats: rscBchOut }
}

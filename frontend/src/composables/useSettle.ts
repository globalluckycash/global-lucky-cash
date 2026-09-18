import { reactive, computed } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getRoundShardAuthContract, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchShardUtxos, fetchSettleEligibleShardIds, broadcastTransaction, getBchMTP } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { buildRSACommitment, buildSSCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { leHex } from '@/lib/bytes'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'

const DUST = 1000n
const FEE_RATE = 1

// status reuses TxState's literal set (see @/types) so it can feed directly into TriggerCard's
// txState prop; total/done/failed are extra batch-progress fields for building "x/64 settled"
// style messages
export interface SettleBatchState {
  status: 'idle' | 'building' | 'awaiting_signature' | 'broadcasting' | 'verifying' | 'success' | 'error'
  total: number
  done: number
  failed: number
  txid: string | null
  error: string | null
}

export function useSettle() {
  const state = reactive<SettleBatchState>({
    status: 'idle', total: 0, done: 0, failed: 0, txid: null, error: null,
  })
  const contractStore = useContractStore()

  // Ready once on-chain MTP (contractStore.pastCutoff) is past the sale cutoff, not every shard
  // is settled yet, and this round hasn't been aggregated
  const isReady = computed(() => {
    if (!contractStore.cutoffTime) return false
    if (!contractStore.pastCutoff) return false
    if (contractStore.aggregated) return false
    const shardCount = contractStore.configState?.shardCount ?? 0
    return contractStore.settledShardCount < shardCount
  })

  /**
   * Settles every shard that has passed its sale cutoff. Each shard is its own tx (fixed
   * 3 outputs, contracts/RoundShardAuth.cash settle()), so shards are built, signed, and
   * broadcast one at a time; a failure on one shard doesn't stop the others.
   */
  async function execute(): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null
    state.total = 0
    state.done = 0
    state.failed = 0

    try {
      const walletStore = useWalletStore()
      const operatorAddress = walletStore.address
      if (!operatorAddress) throw new NotConnectedError()

      const now = await getBchMTP()
      const shardIds = await fetchSettleEligibleShardIds(now)
      state.total = shardIds.length
      if (shardIds.length === 0) {
        throw new Error('目前沒有已達截止售票時間、尚待結算的分片')
      }

      // Processed sequentially; a local set excludes fee UTXOs already spent in this batch but
      // not yet re-indexed by electrum
      const usedFeeUtxoKeys = new Set<string>()
      let lastErr: Error | null = null

      for (const shardId of shardIds) {
        try {
          state.status = 'building'
          const txid = await settleOneShard(shardId, now, usedFeeUtxoKeys, operatorAddress)
          state.done++
          state.txid = txid
          // Each shard's settlement is independent and doesn't touch RSC; optimistically update
          // progress on broadcast success, without waiting for electrum re-indexing
          contractStore.applySettle(1)
        } catch (err) {
          state.failed++
          lastErr = err instanceof Error ? err : new Error(String(err))
        }
      }

      // A partial failure isn't a batch failure as long as at least one shard succeeded; the
      // batch is only marked as failed when every shard fails. Any failure's message is recorded
      // for the caller to display.
      if (state.done > 0) {
        state.status = 'success'
        state.error = state.failed > 0 ? (lastErr?.message ?? null) : null
      } else {
        state.status = 'error'
        state.error = lastErr?.message ?? '結算失敗'
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      state.status = 'error'
    }
  }

  async function settleOneShard(shardId: number, now: bigint, usedFeeUtxoKeys: Set<string>, operatorAddress: string): Promise<string> {
    const cfg = getConfig()
    const shard = await fetchShardUtxos(shardId)
    if (!shard) throw new Error(`shard=${shardId} 找不到 RSA/SS UTXO`)
    const { rsaUtxo, ssUtxo } = shard

    if (ssUtxo.ssState.phase !== 0) throw new Error(`shard=${shardId} 的 ShardSettlementNFT 不是待結算狀態`)
    if (rsaUtxo.shardState.sellingRound + 1 !== ssUtxo.ssState.round) {
      throw new Error(`shard=${shardId} 的 SS.round 與 RSA.sellingRound+1 不符`)
    }
    if (now < ssUtxo.ssState.sellingCutoffTime) {
      throw new Error(`shard=${shardId} 尚未達到截止售票時間`)
    }

    const shardContract = getRoundShardAuthContract(leHex(shardId, 2))

    // Output[0]: RSA advances to the next selling round (shard sales count reset to 0, last-sold
    // time unchanged); gameOverFlag copied from the consumed (pending-settlement) SS, matching
    // contracts/RoundShardAuth.cash settle()
    const newRsaCommitment = buildRSACommitment({
      sellingRound: ssUtxo.ssState.round,
      shardId,
      shardSalesCount: 0,
      exchangeRate: ssUtxo.ssState.nextSellingRate,
      status: rsaUtxo.shardState.status,
      lastSoldTime: rsaUtxo.shardState.lastSoldTime,
      gameOverFlag: ssUtxo.ssState.gameOverFlag,
    })

    // Output[1]: SS transitions to pending-aggregation state (round set to RSA's previous
    // selling round, i.e. the settled round); BCH value = RSA's previous value (this shard's
    // full ticket revenue) — SS's original fee reserve / execute-reward allocation moves to
    // Output[2] instead; gameOverFlag copied from the consumed RSA, matching
    // contracts/RoundShardAuth.cash settle(). nextSellingRate is rewritten to
    // rsaUtxo.shardState.exchangeRate (this shard's actual settled rate for the round just
    // closed), not ssUtxo.ssState.nextSellingRate (that value is the next round's rate, already
    // copied into newRsaCommitment above)
    const newSsCommitment = buildSSCommitment({
      phase: 1,
      round: rsaUtxo.shardState.sellingRound,
      shardId,
      nextSellingRate: rsaUtxo.shardState.exchangeRate,
      sellingCutoffTime: ssUtxo.ssState.sellingCutoffTime,
      shardSalesCount: rsaUtxo.shardState.shardSalesCount,
      lastSoldTime: rsaUtxo.shardState.lastSoldTime,
      gameOverFlag: rsaUtxo.shardState.gameOverFlag,
    })
    const newSsValue = rsaUtxo.valueSats

    const txBuilder = new TransactionBuilder({ provider })
    txBuilder.setLocktime(Number(now))

    txBuilder.addInput(toCsUtxo(rsaUtxo), shardContract.unlock.settle(), { sequence: 0xfffffffe })
    txBuilder.addInput(toCsUtxo(ssUtxo), shardContract.unlock.useForSettle(), { sequence: 0xfffffffe })

    txBuilder.addOutput({
      to: shardContract.tokenAddress,
      amount: DUST,
      token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newRsaCommitment } },
    })
    txBuilder.addOutput({
      to: shardContract.tokenAddress,
      amount: newSsValue,
      token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newSsCommitment } },
    })

    // Output[2]: execute reward, to the triggerer's own address (contract doesn't validate the
    // destination); placeholder dust amount, filled in once the fee is computed
    txBuilder.addOutput({ to: operatorAddress, amount: DUST })

    let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
    let reward = ssUtxo.valueSats - DUST - fee

    // Input[2]: escape hatch, used only when SS's allocation doesn't cover the fee. Contract
    // caps tx.inputs.length at 2 or 3, so only a single plain-BCH input can be added.
    const selectedPlayerUtxos: Awaited<ReturnType<typeof fetchPlayerUtxos>> = []
    if (reward < DUST) {
      const playerUtxos = (await fetchPlayerUtxos()).filter(
        pu => !usedFeeUtxoKeys.has(`${pu.utxo.txid}:${pu.utxo.vout}`)
      )
      const escapePu = playerUtxos[0]
      if (!escapePu) {
        throw new Error(`shard=${shardId} SS 撥款不足付手續費（缺口 ${DUST - reward} sats），且找不到逃生閥用的 plain BCH UTXO`)
      }
      txBuilder.addInput(toCsUtxo(escapePu.utxo), placeholderP2PKHUnlocker(escapePu.address))
      selectedPlayerUtxos.push(escapePu)
      usedFeeUtxoKeys.add(`${escapePu.utxo.txid}:${escapePu.utxo.vout}`)
      fee = estimateFeeForWc(txBuilder, FEE_RATE, 1)
      reward = ssUtxo.valueSats + escapePu.utxo.valueSats - DUST - fee
      if (reward < DUST) {
        throw new Error(`shard=${shardId} 逃生閥 UTXO 仍不足付手續費：缺口 ${DUST - reward} sats`)
      }
    }
    txBuilder.outputs[txBuilder.outputs.length - 1].amount = reward

    const txHex = txBuilder.build()

    // settle() has no checkSig(); Input[0,1] are both contract-unlocked and need no player
    // signature. Only the escape-hatch input (Input[2], plain BCH) needs wallet signing — when
    // selectedPlayerUtxos is empty, txBuilder.build() already produces the final, broadcastable tx
    if (selectedPlayerUtxos.length === 0) {
      return await broadcastTransaction(txHex)
    }

    const sourceOutputs = [
      toSourceOutput(rsaUtxo, shardContract.lockingBytecode),
      toSourceOutput(ssUtxo, shardContract.lockingBytecode),
      ...selectedPlayerUtxos.map(pu => toSourceOutput(pu.utxo, getLockingBytecodeHex(pu.address))),
    ]
    const inputPaths = selectedPlayerUtxos.map((pu, i) => [2 + i, pu.pathName, pu.addressIndex] as [number, string, number])

    state.status = 'awaiting_signature'
    try {
      const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.settle_shard', { shardId }))
      return await broadcastTransaction(signedTxHex)
    } catch (err) {
      if (!(err instanceof SignatureConnectionLostError)) throw err
      // Connection may drop while switching to the wallet app for signing; verify whether the
      // new RSA commitment (advanced to the next selling round) already appeared at this
      // shard's own address.
      state.status = 'verifying'
      const recovered = await pollForCommitment(shardContract.tokenAddress, cfg.authNftCategoryId, newRsaCommitment)
      if (!recovered) throw new Error(i18n.global.t('errors.wallet_result_unknown'))
      return recovered.txid
    }
  }

  function reset() {
    state.status = 'idle'
    state.total = 0
    state.done = 0
    state.failed = 0
    state.txid = null
    state.error = null
  }

  return { state, isReady, execute, reset }
}

import { reactive, computed } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchDrawingNftUtxo, fetchRSCUtxo, fetchAllJackpotPools, broadcastTransaction } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseDrawingNftCommitment, parseRSCCommitment, parseJPCommitment, buildJPCommitment, buildCRCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { toCsUtxo, toSourceOutput, addBchChangeOutputForWc, estimateFeeForWc } from '@/lib/txUtils'
import { ticketPriceSats, oneUsdSats } from '@/lib/pricing'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState } from '@/types'

const DUST = 1000n
const FEE_RATE = 1
// Drawing.cash cancelDraw(): triggerable once 2 hours past expectedDrawTime
const OVERDUE_THRESHOLD = 7200n

/**
 * Cancels a draw that's overdue by 2+ hours. Anyone can trigger it; reclaims this round's share
 * already credited to JackpotPoolNFT back into the fixed prize pool (see scripts/cancelDraw.ts).
 */
export function useCancelDraw() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  const contractStore = useContractStore()

  const isReady = computed(() => {
    const drawing = contractStore.drawingNftState
    if (!drawing) return false
    if (drawing.cumulativeSales === 0n) return true
    return contractStore.chainMtp >= drawing.expectedDrawTime + OVERDUE_THRESHOLD
  })

  async function execute(): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      if (!walletStore.address) throw new NotConnectedError()

      const [drawUtxo, rscUtxo, allJp, playerUtxos] = await Promise.all([
        fetchDrawingNftUtxo(),
        fetchRSCUtxo(),
        fetchAllJackpotPools(),
        fetchPlayerUtxos(),
      ])
      if (!drawUtxo?.token?.nft) throw new Error('找不到 DrawingNFT，本期可能尚未進入開獎階段或已開獎')
      const jpEntry = allJp.find(j => j.state.winnerCount === 0)
      if (!jpEntry) throw new Error('找不到累積中的 JackpotPoolNFT')
      const jpUtxo = jpEntry.utxo

      const drawState = parseDrawingNftCommitment(drawUtxo.token.nft.commitment)
      const rscState = parseRSCCommitment(rscUtxo.token!.nft!.commitment)
      const jpState = parseJPCommitment(jpUtxo.token!.nft!.commitment)

      const threshold = drawState.expectedDrawTime + OVERDUE_THRESHOLD
      if (drawState.cumulativeSales !== 0n && contractStore.chainMtp < threshold) {
        throw new Error(`尚未達到取消條件：還需等待約 ${threshold - contractStore.chainMtp} 秒（開獎逾期需超過 2 小時）`)
      }

      // saleRate is RSC's staged rate — draw() hasn't run yet this round, so it still equals the
      // round's effective sale rate. Scaled ×100 (ATTESTATION_SCALING); divide back out.
      const ticketPriceSatsValue = ticketPriceSats(rscState.stagedRate)
      const roundRevenue = ticketPriceSatsValue * drawState.cumulativeSales
      const platformCut = roundRevenue * 20n / 100n
      const fixedCut = roundRevenue * 30n / 100n
      // JP only received 50% in enterDrawingPhase() (20/30/50 split); reclaim the matching share
      const jpRefundWanted = roundRevenue - platformCut - fixedCut
      const jpRefundCap = jpUtxo.valueSats - DUST
      const jpRefund = jpRefundWanted > jpRefundCap ? jpRefundCap : jpRefundWanted

      // Execute reward is a fixed 1 USD equivalent, independent of ticket price — converted separately
      const executeShare = oneUsdSats(rscState.stagedRate)
      let drawingLeftover = drawUtxo.valueSats - DUST - executeShare
      if (drawingLeftover < 0n) drawingLeftover = 0n

      const fixedPoolAmount = DUST + jpRefund + drawingLeftover
      const newJpValue = jpUtxo.valueSats - jpRefund

      const crCommitment = buildCRCommitment({
        round: drawState.round,
        cumulativeSales: drawState.cumulativeSales,
        saleRate: rscState.stagedRate,
      })
      const updatedJpState = { ...jpState, currentDrawRound: drawState.round, totalBCH: newJpValue }
      const updatedJpCommitment = buildJPCommitment(updatedJpState)

      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))
      // Drawing.cash cancelDraw(): Output[4]/Output[5] must both equal Input[3]'s lockingBytecode
      // (the first fee input), so the execute reward and change both go to that address — the
      // loop below always selects playerUtxos[0] first.
      const feeAddress = playerUtxos[0].address

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(drawUtxo), cfg.drawingContract.unlock.cancelDraw(), { sequence: 0xfffffffe })
      txBuilder.addInput(toCsUtxo(rscUtxo), cfg.roundSwitchControlContract.unlock.cancelDraw(), { sequence: 0xfffffffe })
      txBuilder.addInput(toCsUtxo(jpUtxo), cfg.jackpotPoolContract.unlock.cancelDraw(), { sequence: 0xfffffffe })

      // Output[0]: fixed prize pool address (plain BCH, no NFT)
      txBuilder.addOutput({ to: cfg.fixedPrizePoolContract.address, amount: fixedPoolAmount })
      // Output[1]: CanceledRoundNFT (newly minted, sent to the fixed prize pool address, kept permanently)
      txBuilder.addOutput({
        to: cfg.fixedPrizePoolContract.tokenAddress,
        amount: DUST,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: crCommitment } },
      })
      // Output[2]: RSC NFT (returned unchanged)
      txBuilder.addOutput({
        to: cfg.roundSwitchControlContract.tokenAddress,
        amount: rscUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: rscUtxo.token!.nft!.commitment } },
      })
      // Output[3]: JackpotPoolNFT (back to its contract, BCH -= jpRefund, frozen jackpot total updated to match)
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: newJpValue,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: updatedJpCommitment } },
      })
      // Output[4]: execute reward address (plain BCH, exactly 1 USD, funded from DrawingNFT's own reserve)
      txBuilder.addOutput({ to: feeAddress, amount: executeShare })

      // Input[3+]: player plain BCH, added one at a time until fee + change dust is covered.
      // Fee is computed from the tx's actual current size (including placeholder-P2PKH
      // correction) rather than a fixed margin guess, since the contract enforces exactly 6 outputs.
      const covenantInTotal = drawUtxo.valueSats + rscUtxo.valueSats + jpUtxo.valueSats
      const totalOutOthers = fixedPoolAmount + DUST + rscUtxo.valueSats + newJpValue + executeShare

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

      // Output[5]: BCH change (separate from the execute reward; contract enforces tx.outputs.length == 6)
      addBchChangeOutputForWc(txBuilder, { to: feeAddress, feeRate: FEE_RATE }, selectedPlayerUtxos.length)

      const txHex = txBuilder.build()

      // Contract inputs: drawing(0), rsc(1), jp(2); fee inputs start at 3
      const contractInputCount = 3
      const sourceOutputs = [
        toSourceOutput(drawUtxo, cfg.drawingContract.lockingBytecode),
        toSourceOutput(rscUtxo, cfg.roundSwitchControlContract.lockingBytecode),
        toSourceOutput(jpUtxo, cfg.jackpotPoolContract.lockingBytecode),
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
        contractStore.applyCancelDraw(updatedJpState, newJpValue - DUST)
        state.status = 'success'
      }

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.cancel_draw'))
        applySuccess(await broadcastTransaction(signedTxHex))
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing; verify whether the
        // newly minted CanceledRoundNFT already appeared at the fixed prize pool address.
        state.status = 'verifying'
        const recovered = await pollForCommitment(cfg.fixedPrizePoolContract.tokenAddress, cfg.authNftCategoryId, crCommitment)
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

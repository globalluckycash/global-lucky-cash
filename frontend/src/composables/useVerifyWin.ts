import { reactive } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getNumberSalesContract, getLockingBytecodeHex } from '@/lib/contractConfig'
import { broadcastTransaction } from '@/lib/electrum'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import { parseWNCommitment, parseNSCommitment, parseRSCCommitment, parseJPCommitment, buildJPCommitment } from '@/lib/nftDecode'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { toCsUtxo, toSourceOutput, estimateFeeForWc } from '@/lib/txUtils'
import { oneUsdSats } from '@/lib/pricing'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState, Utxo } from '@/types'

const DUST = 1000n
const FEE_RATE = 1
const CLAIM_WINDOW = 7776000n  // 90 days in seconds

export interface VerifyWinParams {
  jpUtxo: Utxo     // Accumulating JackpotPoolNFT
  wnUtxo: Utxo     // WinningNumberNFT at JP contract (consumed)
  nsUtxo: Utxo     // NumberSalesNFT for the winning combo
  rscUtxo: Utxo    // RoundSwitchControlNFT (returned unchanged)
}

export function useVerifyWin() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  const contractStore = useContractStore()

  async function execute(params: VerifyWinParams): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const operatorAddress = walletStore.address
      if (!operatorAddress) throw new NotConnectedError()

      const { jpUtxo, wnUtxo, nsUtxo, rscUtxo } = params

      const jp = parseJPCommitment(jpUtxo.token!.nft!.commitment)
      const wn = parseWNCommitment(wnUtxo.token!.nft!.commitment)
      const ns = parseNSCommitment(nsUtxo.token!.nft!.commitment)
      const rscState = parseRSCCommitment(rscUtxo.token!.nft!.commitment)
      // The winning number combo has its own contract address (NumberSales.cash lotteryNumber constructor param)
      const nsContract = getNumberSalesContract(ns.lotteryNumber)

      if (jp.winnerCount !== 0) throw new Error('This JackpotPoolNFT has already recorded a winner for its cycle')

      // winCount: oddCount for odd rounds, evenCount for even rounds
      const isOddRound = wn.drawRound % 2 !== 0
      const winCount = isOddRound ? ns.oddCount : ns.evenCount

      // Old pool commitment: archives this round's result; accumulateFrom carries over the
      // existing JP's value
      const oldJpState = {
        accumulateFrom: jp.accumulateFrom,
        currentDrawRound: wn.drawRound,
        n1: wn.n1, n2: wn.n2, n3: wn.n3, s: wn.s,
        winnerCount: winCount,
        claimCount: winCount,
        totalBCH: jp.totalBCH,
        lastClaimTime: rscState.cutoffTime + CLAIM_WINDOW,
      }
      const oldJpCommitment = buildJPCommitment(oldJpState)

      // Execute reward: fixed 1 USD equivalent, funded from WinningNumberNFT's platform-share
      // balance; any shortfall is covered by the operator's own plain BCH.
      // wnBCH must match JackpotPool.cash's tx.inputs[1].value (WN's full face value, not minus
      // dust). Uses WN's own saleRate (the same rate as its buffered funds), not RSC's current
      // staged rate.
      const wnBCH = wnUtxo.valueSats
      // saleRate is scaled ×100 (oracle ATTESTATION_SCALING); divide back out
      const executeShare = oneUsdSats(wn.saleRate)
      const requiredForVerify = executeShare + DUST
      const platformRemainder = wnBCH > requiredForVerify ? wnBCH - requiredForVerify : 0n
      const shortfall = requiredForVerify > wnBCH ? requiredForVerify - wnBCH : 0n
      // Contract requires Output[4].value == 1000 + leftoverBCH, so the PlatformPool output
      // must include this dust
      const platformPoolValue = DUST + platformRemainder
      // Old JP pool value equals its input exactly (no execute-reward deduction, players can claim in full)
      const jpOldValue = jpUtxo.valueSats

      const playerUtxos = await fetchPlayerUtxos()
      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))
      // fetchPlayerUtxos() may scan multiple addresses. Contract checks tying an output back to
      // a specific input's on-chain lockingBytecode only reference the *first* fee input, so
      // that one's address (always selected first below) is used for reward/change outputs.
      const feeAddress = playerUtxos[0].address

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(jpUtxo), cfg.jackpotPoolContract.unlock.verifyWin())
      txBuilder.addInput(toCsUtxo(wnUtxo), cfg.jackpotPoolContract.unlock.spendWinningNumber())
      txBuilder.addInput(toCsUtxo(nsUtxo), nsContract.unlock.verifyWin())
      txBuilder.addInput(toCsUtxo(rscUtxo), cfg.roundSwitchControlContract.unlock.verifyWin())

      // Output[0]: old JP pool, archives this round's result; no execute-reward deduction,
      // players can claim in full
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: jpOldValue,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: oldJpCommitment } },
      })

      // Output[1]: NS unchanged
      txBuilder.addOutput({
        to: nsContract.tokenAddress,
        amount: nsUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'mutable', commitment: nsUtxo.token!.nft!.commitment } },
      })
      // Output[2]: RSC unchanged
      txBuilder.addOutput({
        to: cfg.roundSwitchControlContract.tokenAddress,
        amount: rscUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: rscUtxo.token!.nft!.commitment } },
      })

      // Output[3]: execute reward address, plain BCH, exactly 1 USD, separate from change
      const requiredReward = executeShare
      txBuilder.addOutput({ to: feeAddress, amount: requiredReward })

      // Output[4]: PlatformPool, WinningNumberNFT's balance after the execute reward
      txBuilder.addOutput({ to: cfg.platformPoolContract.address, amount: platformPoolValue })

      const newJpAmount = winCount > 0 ? DUST : 0n
      // The accumulating JackpotPoolNFT (winnerCount === 0): when there's a winner, it's a
      // freshly minted pool (totalBCH reset to 0); when there isn't, Output[0] itself
      // (winnerCount still 0) is the pool that keeps accumulating — see applyVerifyWin below.
      const freshJpState = {
        accumulateFrom: wn.drawRound + 1,
        currentDrawRound: wn.drawRound,
        n1: 0, n2: 0, n3: 0, s: 0,
        winnerCount: 0,
        claimCount: 0,
        totalBCH: 0n,
        lastClaimTime: 0n,
      }
      if (winCount > 0) {
        // Output[5]: new JP pool (minted), accumulateFrom = drawRound+1; before the next draw,
        // currentDrawRound = accumulateFrom-1 = drawRound
        const freshJpCommitment = buildJPCommitment(freshJpState)
        txBuilder.addOutput({
          to: cfg.jackpotPoolContract.tokenAddress,
          amount: newJpAmount,
          token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: freshJpCommitment } },
        })
      }

      // Input[4+]: player plain BCH, added one at a time until shortfall (if any), new-JP dust
      // (if any), and change dust are all covered; fee computed from the tx's actual current
      // size (including placeholder-P2PKH correction) rather than a fixed margin guess.
      const requiredExtra = shortfall + newJpAmount
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

      // Output[5 or 6]: change BCH, separate from the execute reward, right after the last
      // output; placeholder amount, filled in once every output is set and tx size can be
      // estimated
      const changeOutputIndex = txBuilder.outputs.length
      txBuilder.addOutput({ to: feeAddress, amount: DUST })
      fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedPlayerUtxos.length)
      const changeValue = payTotal - requiredExtra - fee
      if (changeValue < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }
      txBuilder.outputs[changeOutputIndex].amount = changeValue

      const txHex = txBuilder.build()

      // Contract inputs: jp(0), wn(1), ns(2), rsc(3); fee inputs start at 4
      const contractInputCount = 4
      const sourceOutputs = [
        toSourceOutput(jpUtxo, cfg.jackpotPoolContract.lockingBytecode),
        toSourceOutput(wnUtxo, cfg.jackpotPoolContract.lockingBytecode),
        toSourceOutput(nsUtxo, nsContract.lockingBytecode),
        toSourceOutput(rscUtxo, cfg.roundSwitchControlContract.lockingBytecode),
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
        contractStore.applyVerifyWin(
          winCount > 0 ? freshJpState : oldJpState,
          winCount > 0 ? newJpAmount - DUST : jpOldValue - DUST
        )
        state.status = 'success'
      }

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.verify_win'))
        applySuccess(await broadcastTransaction(signedTxHex))
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing; verify whether
        // Output[0]'s commitment (the archived old pool) already appeared at the JP contract's
        // own address — this output is always produced regardless of whether there's a winner.
        state.status = 'verifying'
        const recovered = await pollForCommitment(cfg.jackpotPoolContract.tokenAddress, cfg.authNftCategoryId, oldJpCommitment)
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

  return { state, execute, reset }
}

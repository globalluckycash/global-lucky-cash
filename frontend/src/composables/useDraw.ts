import { reactive, ref } from 'vue'
import { TransactionBuilder, placeholderP2PKHUnlocker } from 'cashscript'
import { provider, getConfig, getLockingBytecodeHex } from '@/lib/contractConfig'
import { fetchDrawingNftUtxo, fetchRSCUtxo, broadcastTransaction } from '@/lib/electrum'
import { fetchOracleMessages } from '@/lib/oracle'
import { fetchPlayerUtxos, requestSignature, NotConnectedError, SignatureConnectionLostError } from '@/lib/walletBridge'
import {
  parseDrawingNftCommitment, parseRSCCommitment,
  buildRSCCommitment, buildWNCommitment, computeDrawNumbers,
} from '@/lib/nftDecode'
import { leHexToNumber, hexToBin } from '@/lib/bytes'
import { oneUsdSats } from '@/lib/pricing'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { toCsUtxo, toSourceOutput, addBchChangeOutputForWc, estimateFeeForWc } from '@/lib/txUtils'
import { pollForCommitment } from '@/lib/broadcastRetry'
import { i18n } from '@/i18n'
import type { TxState } from '@/types'

const DUST = 1000n
const FEE_RATE = 1

export interface DrawResult {
  round: number
  n1: number
  n2: number
  n3: number
  s: number
}

export function useDraw() {
  const state = reactive<TxState>({ status: 'idle', txid: null, error: null })
  const result = ref<DrawResult | null>(null)
  const contractStore = useContractStore()

  async function execute(): Promise<void> {
    state.status = 'building'
    state.error = null
    state.txid = null
    result.value = null

    try {
      const cfg = getConfig()
      const walletStore = useWalletStore()
      const operatorAddress = walletStore.address
      if (!operatorAddress) throw new NotConnectedError()

      const drawingUtxo = await fetchDrawingNftUtxo()
      if (!drawingUtxo?.token?.nft) throw new Error('DrawingNFT not found — enter drawing phase first')

      const drawState = parseDrawingNftCommitment(drawingUtxo.token.nft.commitment)
      if (drawState.cumulativeSales === 0n) {
        throw new Error('本期無售出票，應改由「取消開獎」處理')
      }

      const [oracleMsgs, rscUtxo, playerUtxos] = await Promise.all([
        fetchOracleMessages(drawState.expectedDrawTime),
        fetchRSCUtxo(),
        fetchPlayerUtxos(),
      ])
      const [msg1, msg2] = oracleMsgs
      const rscState = parseRSCCommitment(rscUtxo.token!.nft!.commitment)

      // executeShare: fixed 1 USD equivalent; any shortfall is covered by the operator's own
      // plain BCH UTXOs selected below. stagedRate is scaled x100 by the oracle
      // (ATTESTATION_SCALING), divided back out here.
      // leftoverBCH forwarded to the JP-side WinningNumberNFT = executeShare*2 minus 1000 sats
      // dust: own reward's 1 share plus 2 shares reserved for verifyWin() to spend later, split
      // across 3 dust outputs (Output[0]/[1]/[3]).
      const executeShare = oneUsdSats(rscState.stagedRate)
      let leftoverBCH = executeShare * 2n - 1000n
      if (leftoverBCH < 0n) leftoverBCH = 0n
      const wnJpValue = DUST + leftoverBCH

      if (playerUtxos.length === 0) throw new Error(i18n.global.t('toast.insufficient_balance'))
      // fetchPlayerUtxos() may return UTXOs from multiple addresses. Drawing.draw()'s
      // Output[3]/[4] must equal Input[2]'s lockingBytecode (the first fee input), so that
      // address is used for both outputs — the loop below always selects playerUtxos[0] first.
      const feeAddress = playerUtxos[0].address

      // New rate from oracle msg2 DataContent bytes[12..15] = hex[24..32], already in
      // ATTESTATION_SCALING format
      const newRate = leHexToNumber(msg2.message.slice(24, 32))

      // Draw numbers from msg2 signature
      const { n1, n2, n3, s } = await computeDrawNumbers(msg2.signature)
      result.value = { round: drawState.round, n1, n2, n3, s }

      // saleRate = RSC's stagedRate before this tx overwrites it (this round's actual sale rate)
      const newWnState = {
        drawRound: drawState.round,
        n1, n2, n3, s,
        cumulativeSales: drawState.cumulativeSales,
        saleRate: rscState.stagedRate,
      }
      const wnCommitment = buildWNCommitment(newWnState)
      const newRscState = { ...rscState, stagedRate: newRate }
      const newRSCCommitment = buildRSCCommitment(newRscState)

      const txBuilder = new TransactionBuilder({ provider })
      txBuilder.addInput(toCsUtxo(drawingUtxo), cfg.drawingContract.unlock.draw(
        hexToBin(msg1.message),
        hexToBin(msg1.signature),
        hexToBin(msg2.message),
        hexToBin(msg2.signature),
      ))
      txBuilder.addInput(toCsUtxo(rscUtxo), cfg.roundSwitchControlContract.unlock.draw())

      // Two WN NFTs minted: one to FPP (minting, authorizes claimFixedPrize's ticket re-mint),
      // one to JP (immutable, for verifyWin)
      txBuilder.addOutput({
        to: cfg.fixedPrizePoolContract.tokenAddress,
        amount: DUST,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: wnCommitment } },
      })
      txBuilder.addOutput({
        to: cfg.jackpotPoolContract.tokenAddress,
        amount: wnJpValue,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'none', commitment: wnCommitment } },
      })
      txBuilder.addOutput({
        to: cfg.roundSwitchControlContract.tokenAddress,
        amount: rscUtxo.valueSats,
        token: { category: cfg.authNftCategoryId, amount: 0n, nft: { capability: 'minting', commitment: newRSCCommitment } },
      })
      // Output[3]: execute reward address (plain BCH, exactly 1 USD, separate from change)
      const requiredReward = executeShare
      txBuilder.addOutput({ to: feeAddress, amount: requiredReward })

      // Input[2+]: player plain BCH, added one at a time until fee + change dust is covered.
      // Fee is computed from the tx's actual current size (including placeholder-P2PKH
      // correction) rather than a fixed margin guess, since the contract enforces exactly 5
      // outputs.
      const covenantInTotal = drawingUtxo.valueSats + rscUtxo.valueSats
      const totalOutBeforeChange = DUST + wnJpValue + rscUtxo.valueSats + requiredReward

      const selectedPlayerUtxos: typeof playerUtxos = []
      let payTotal = 0n
      let fee = estimateFeeForWc(txBuilder, FEE_RATE, 0)
      let surplus = covenantInTotal - totalOutBeforeChange - fee
      for (const pu of playerUtxos) {
        if (surplus >= DUST) break
        txBuilder.addInput(toCsUtxo(pu.utxo), placeholderP2PKHUnlocker(pu.address))
        selectedPlayerUtxos.push(pu)
        payTotal += pu.utxo.valueSats
        fee = estimateFeeForWc(txBuilder, FEE_RATE, selectedPlayerUtxos.length)
        surplus = covenantInTotal + payTotal - totalOutBeforeChange - fee
      }
      if (surplus < DUST) {
        throw new Error(i18n.global.t('toast.insufficient_balance'))
      }
      const playerUtxoAddresses = selectedPlayerUtxos.map(pu => pu.address)

      // Output[4]: BCH change (separate from the execute reward; contract enforces tx.outputs.length == 5)
      addBchChangeOutputForWc(txBuilder, { to: feeAddress, feeRate: FEE_RATE }, selectedPlayerUtxos.length)

      const txHex = txBuilder.build()

      // Contract inputs: drawing (0), rsc (1); fee inputs start at 2
      const contractInputCount = 2
      const sourceOutputs = [
        toSourceOutput(drawingUtxo, cfg.drawingContract.lockingBytecode),
        toSourceOutput(rscUtxo, cfg.roundSwitchControlContract.lockingBytecode),
        ...selectedPlayerUtxos.map((pu, i) => toSourceOutput(pu.utxo, getLockingBytecodeHex(playerUtxoAddresses[i]))),
      ]
      const inputPaths = selectedPlayerUtxos.map((pu, i) => [
        contractInputCount + i,
        pu.pathName,
        pu.addressIndex,
      ] as [number, string, number])

      // Optimistically update contractStore on broadcast success, without waiting for electrum re-indexing
      function applySuccess(txid: string) {
        state.txid = txid
        contractStore.applyDraw(newRscState, newWnState)
        state.status = 'success'
      }

      state.status = 'awaiting_signature'
      try {
        const signedTxHex = await requestSignature(txBuilder, txHex, sourceOutputs, inputPaths, i18n.global.t('wallet_action.draw'))
        applySuccess(await broadcastTransaction(signedTxHex))
      } catch (err) {
        if (!(err instanceof SignatureConnectionLostError)) throw err
        // Connection may drop while switching to the wallet app for signing; verify whether the
        // updated RSC commitment (stagedRate rewritten) already appeared at the contract's own
        // address.
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

  return { state, execute, reset, result }
}

/**
 * 購票交易廣播失敗時的分類與自動重試策略。
 *
 * 玩家購票時會用到共用的 RSA shard UTXO 與 NumberSales UTXO（見 electrum.ts），若另一位
 * 玩家搶先花掉同一顆 UTXO，慢的一方廣播時會被節點拒絕。cashscript 的 ElectrumNetworkProvider
 * 已將這類 electrum 回應分類成專門的錯誤子類別（見 node_modules/cashscript/dist/network/
 * errors.js），這裡只處理其中「重新抓最新 UTXO 重建交易就有機會解決」的兩種：
 * - NetworkProviderMissingInputsError：對方交易已上鏈或進 mempool，UTXO 已不存在
 * - NetworkProviderMempoolConflictError：雙方幾乎同時送出，節點偵測到 mempool 衝突
 * 其餘分類（AlreadySubmitted／AbsoluteTimelock／RelativeTimelock）不是 UTXO 競態，重試也
 * 不會改變結果，只做友善訊息轉譯、不自動重試。
 */
import {
  NetworkProviderMissingInputsError,
  NetworkProviderMempoolConflictError,
  NetworkProviderTransactionAlreadySubmittedError,
  NetworkProviderAbsoluteTimelockError,
  NetworkProviderRelativeTimelockError,
} from 'cashscript'
import { i18n } from '@/i18n'
import { findUtxoByCommitment, findUtxosByCommitment } from '@/lib/electrum'
import type { Utxo } from '@/types'

/** 達到這個重試次數仍失敗就放棄，交由玩家看最終錯誤訊息並手動重試 */
export const MAX_UTXO_RACE_RETRIES = 8

const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 100_000

/** 錯誤代表「同一顆 UTXO 被別的玩家搶先花掉」——重新抓最新 UTXO 重建交易後有機會解決 */
export function isUtxoRaceError(err: unknown): boolean {
  return err instanceof NetworkProviderMissingInputsError || err instanceof NetworkProviderMempoolConflictError
}

/** 第 attempt 次重試前要等待的毫秒數（attempt 從 1 起算）：1s→2s→4s→...→100s 封頂 */
export function utxoRaceBackoffMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 達到 MAX_UTXO_RACE_RETRIES 次仍失敗時要拋出的最終錯誤，取代單次錯誤訊息，讓玩家知道是「重試多次後」才放棄 */
export function utxoRaceExhaustedError(): Error {
  return new Error(i18n.global.t('errors.utxo_race_failed', { max: MAX_UTXO_RACE_RETRIES }))
}

/**
 * requestSignature() 逾時（SignatureConnectionLostError）後查證交易是否其實已在鏈上成功：
 * 反覆查詢預期會出現新 commitment 的地址，累計約 45 秒，給 relay 遲來的重連/補送留時間。
 * 查不到回傳 null（真的還沒有 / 真的失敗），不拋錯，讓呼叫端決定要顯示什麼最終狀態。
 */
export async function pollForCommitment(address: string, category: string, commitmentHex: string): Promise<Utxo | null> {
  for (const delayMs of [0, 3000, 6000, 12000, 24000]) {
    if (delayMs) await sleep(delayMs)
    const found = await findUtxoByCommitment(address, category, commitmentHex)
    if (found) return found
  }
  return null
}

/**
 * 跟 pollForCommitment() 一樣的查證窗口，但用於「同參數重複操作會產生 byte-for-byte
 * 相同 commitment」的情境（例如玩家在同一輪、同匯率下重複買同一組號碼）——單純查
 * 「存在」沒辦法分辨查到的是舊的還是這次新增的，這裡改成比對「送出簽名前記錄的既有
 * UTXO 集合（beforeKeys，`${txid}:${vout}` 字串）」，只有出現一個不在裡面的才算數。
 */
export async function pollForNewCommitment(
  address: string, category: string, commitmentHex: string, beforeKeys: string[]
): Promise<Utxo | null> {
  const beforeSet = new Set(beforeKeys)
  for (const delayMs of [0, 3000, 6000, 12000, 24000]) {
    if (delayMs) await sleep(delayMs)
    const matches = await findUtxosByCommitment(address, category, commitmentHex)
    const fresh = matches.find(u => !beforeSet.has(`${u.txid}:${u.vout}`))
    if (fresh) return fresh
  }
  return null
}

/** 把節點拒絕交易的錯誤轉成玩家看得懂的中文提示，非此類錯誤原樣回傳原始訊息 */
export function friendlyBroadcastError(err: unknown): string {
  const t = i18n.global.t
  if (err instanceof NetworkProviderMissingInputsError) return t('errors.utxo_taken')
  if (err instanceof NetworkProviderMempoolConflictError) return t('errors.utxo_conflict')
  if (err instanceof NetworkProviderTransactionAlreadySubmittedError) return t('errors.tx_already_submitted')
  if (err instanceof NetworkProviderAbsoluteTimelockError) return t('errors.tx_timelock')
  if (err instanceof NetworkProviderRelativeTimelockError) return t('errors.tx_timelock')
  return err instanceof Error ? err.message : String(err)
}

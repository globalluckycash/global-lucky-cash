/**
 * roundSchedule.ts — 冷資料（RSC/JP/FPP/latestWN/DrawingNFT/WN-at-JP）輪詢排程
 *
 * 設計依據：docs/frontend_nft_polling_schedule_design.md
 *
 * cutoffTime 在一個 round 的售票期間保證不變（只有換輪那一刻才會改變，而那正是
 * 我們要偵測的轉換本身），所以不需要每次都重讀鏈上狀態去確認「是不是還沒到」——
 * 上一次讀到的 cutoffTime 本身就是可靠的排程依據，直到它真的變了為止。
 *
 * isReady（是否可以執行 roundSwitch/enterDrawingPhase/draw/verifyWin）一律要用
 * 真正讀到的鏈上 MTP 判斷，這裡只決定「什麼時候該花成本重新讀一次」，不能取代
 * 那個判斷本身（見 stores/contract.ts 的 pastCutoff）。
 */

export type PollTier = 'quiescent' | 'approaching' | 'imminent'

// MTP 一律落後真實時間、落後量不固定（約 1-2 小時，非保證值），緩衝抓寬避免
// 「接近期」誤判成「還很久」而錯過該提高頻率的時機。抓寬只是多讀幾次鏈，
// 抓太窄則可能讓玩家在真正可以換輪的當下，前端卻還停在慢速輪詢。
export const APPROACH_BUFFER_SEC = 3n * 3_600n

export const TIER_INTERVAL_MS: Record<PollTier, number> = {
  quiescent: 5 * 60_000,
  approaching: 90_000,
  imminent: 20_000,
}

export interface ColdPollContext {
  /** 目前（快取的）RSC.cutoffTime；在同一輪售票期間保證不變 */
  cutoffTime: bigint
  /** 是否已過本輪 cutoff（不論換輪／開獎流程是否已經開始） */
  pastCutoff: boolean
  /** 換輪～驗證完成之間的開獎流程是否還在進行中（DrawingNFT／WN-at-JP／已有shard切換） */
  drawingRoundActive: boolean
  /** 本地估計現在時間，Date.now()/1000 即可，不必精確——這一層只決定輪詢頻率 */
  estimatedNow: bigint
}

/**
 * 依目前所處階段決定 Tier 2（冷資料）該用哪個輪詢檔位：
 * - 已過 cutoff 或開獎流程還在進行中：不管公式估計的下一個時間點是什麼，
 *   一律緊盯（imminent），直到觀察到預期的狀態變化（round+1／DrawingNFT 消失等）
 * - 還在售票期：用快取的 cutoffTime 估計還有多久，決定 approaching / quiescent
 */
export function currentTier(ctx: ColdPollContext): PollTier {
  if (ctx.pastCutoff || ctx.drawingRoundActive) return 'imminent'

  const untilCutoff = ctx.cutoffTime - ctx.estimatedNow
  if (untilCutoff <= APPROACH_BUFFER_SEC) return 'approaching'
  return 'quiescent'
}

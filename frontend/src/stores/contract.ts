import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchRSCState,
  fetchCurrentJackpotState,
  fetchFixedPrizePoolBalance,
  fetchLatestWinningNumber,
  fetchAllRSAShardStates,
  fetchAggregateReadySSUtxos,
  fetchDrawingNftState,
  fetchWNAtJackpotPool,
  fetchConfigUtxo,
  fetchDonationMessageEntries,
  getBchMTP,
  type DonationMessageEntry,
} from '@/lib/electrum'
import { parseWNCommitment, parseConfigCommitment } from '@/lib/nftDecode'
import { currentTier, TIER_INTERVAL_MS } from '@/lib/roundSchedule'
import type { RSCNftState, WNNftState, JPNftState, DrawingNftState, ConfigNftState } from '@/types'

const DUST = 1000n

// 尚未經 enterDrawingPhase() 分配的資金池（RSA shard 或已彙整進 RSC 的 totalBCH），
// 最終只有其中約 50% 會進頭獎——比照 RoundSwitchControl.cash / useEnterDrawingPhase.ts
// 的 20%(platform)/30%(fixed)/50%(jackpot) 分帳算法估算頭獎那一份，忽略
// executeShare/reserve 對 platformShare 的扣減（不影響 jackpotShare）與極端小額才會
// 觸發的 dust 下限差異（僅在總額逼近 1000 sats 等級才有感）
function estimateJackpotShare(totalBCH: bigint): bigint {
  if (totalBCH <= 0n) return 0n
  const platformShare = totalBCH * 20n / 100n
  const fixedShare = totalBCH * 30n / 100n
  const jackpotShare = totalBCH - platformShare - fixedShare
  return jackpotShare > DUST ? jackpotShare : DUST
}

export const useContractStore = defineStore('contract', () => {
  const rscState           = ref<RSCNftState | null>(null)
  // RSC NFT 自身的 UTXO 面額——round switch 期間，被切換 shard 的票款會先併入這裡
  // （高於 DUST 的部分），直到 enterDrawingPhase() 才會被吸收進 JP/FPP/PlatformPool
  const rscValueSats       = ref<bigint>(0n)
  const jackpotSats        = ref<bigint>(0n)
  // 當期（purchaseRound）尚未經 roundSwitch() 併入 RSC 的 RSA shard 票款總和——
  // 玩家持續買票時這裡會即時增加，JP NFT 本身要等 enterDrawingPhase() 才會反映
  const rsaPoolSats        = ref<bigint>(0n)
  // 當期（purchaseRound）RSA shard 累計已售出票數（跨所有 shard 加總的 shardSalesCount）——
  // 供「每注票價」區塊顯示即時售出張數
  const ticketsSoldThisRound = ref(0)
  // 當期（purchaseRound）RSA shard 結算時鎖定的 exchangeRate（同輪所有 shard 共用同一個值）——
  // 玩家買票實際付款金額是用這個算的，跟 bchUsdRate（RSC 的即時 stagedRate）不是同一個東西，
  // 顯示「目前票價」必須用這個，才會跟下單簽名金額一致
  const purchaseRoundRate  = ref<number>(0)
  const jpState            = ref<JPNftState | null>(null)
  const fppBalance         = ref<bigint>(0n)
  const latestWn           = ref<WNNftState | null>(null)
  const loading            = ref(false)
  const lastError          = ref<string | null>(null)
  // 是否已經有 RSA shard 切到下一輪 —— 這才是「下一期已經可以購買」的真正訊號
  // （RSC 的 round 欄位要等所有 shard 切完 + enterDrawingPhase() 才會 +1，太慢）
  const nextRoundHasShards = ref(false)
  // 現在是否已經超過本期截止收單時間（不論 shard 是否已開始切換）
  const pastCutoff = ref(false)
  // 鏈上 MTP（Median Time Past）——合約實際比對的時間基準，一律落後真實時間，
  // 「結束本輪售票」等交易的可執行判斷要用這個值，不能用 Date.now()
  const chainMtp = ref(0n)
  // 上一輪的 DrawingNFT／WinningNumberNFT（尚在 JackpotPool 等待驗證）是否存在——
  // 用來判斷「結束本輪售票」之後、「計算頭獎人數」之前的開獎流程是否還在進行中
  const drawingNftState       = ref<DrawingNftState | null>(null)
  const wnAtJackpotPoolState  = ref<WNNftState | null>(null)
  // ConfigNFT（genesisTime/roundPeriod/shardCount）——供 enterDrawingPhase() 的
  // useConfig() 輸入，shardCount 也用來判斷彙整是否已收齊全部分片
  const configState           = ref<ConfigNftState | null>(null)
  // 已完成結算（ShardSettlementNFT.phase===1 且 round===drawingRound）的分片數，
  // 供「結算進度」顯示與「彙整」是否已可觸發的判斷；售票截止前恆為 0
  const settledShardCount     = ref(0)
  // 歷史全部 DonationMessageNFT（purpose 0x08，JackpotPool 合約地址，永久保留不銷毀）——
  // 供「本期贊助頭獎」display 篩選加總，見 roundDonationSats
  const donationEntries       = ref<DonationMessageEntry[]>([])

  const currentRound = computed(() => rscState.value?.drawingRound ?? 0)
  const cutoffTime   = computed(() => rscState.value?.cutoffTime ?? 0n)
  const bchUsdRate   = computed(() => rscState.value?.stagedRate ?? 0)
  // 本輪是否已全部結算完成、可觸發 aggregate()（分兩批各 32 片，見規格書 6.3）——
  // 全部分片已結算完成（可以開始第一批）或第一批已完成、等待第二批時皆為 true，
  // aggregate() composable 內部會依 aggregateBatchFlag 自動判斷要跑一批還是兩批
  const aggregateReady = computed(() =>
    aggregateBatchInProgress.value ||
    (configState.value != null && settledShardCount.value >= configState.value.shardCount)
  )
  // 本輪彙整是否卡在「第一批已完成、等待第二批」——因 BCH 100,000 bytes 標準交易大小
  // 上限，aggregate() 分兩批各 32 片執行，見規格書 6.3
  const aggregateBatchInProgress = computed(() => (rscState.value?.aggregateBatchFlag ?? 0) === 1)
  // 本輪是否已彙整完成（lastAggregateTime 非 0 且兩批皆已完成，二態欄位 lastAggregateTime
  // 在只完成第一批時就已經非 0，必須同時確認 aggregateBatchFlag 已歸零才是真正完成），
  // 等待 enterDrawingPhase() 推進到下一輪
  const aggregated = computed(() =>
    (rscState.value?.lastAggregateTime ?? 0n) !== 0n && !aggregateBatchInProgress.value
  )
  // 玩家新購買實際會落在哪一期：一旦下一期已經有 shard 可用，就導向下一期
  const purchaseRound = computed(() =>
    nextRoundHasShards.value ? currentRound.value + 1 : currentRound.value
  )
  // 當期（purchaseRound）RSA 票款「估計會分到頭獎的那一份」——供「每注票價」區塊顯示
  // 本輪目前已增加的頭獎金額，與 totalJackpotSats 共用同一份 50% 分帳估算
  const roundJackpotContributionSats = computed(() => estimateJackpotShare(rsaPoolSats.value))
  // 前台顯示用總獎金：JP NFT 累積金額 + 當期（purchaseRound）RSA shard 票款總和「估計會分到頭獎的那一份」
  // （RSA 池尚未經 enterDrawingPhase() 分帳，全額算入會高估近 2 倍，見 estimateJackpotShare()）
  const totalJackpotSats = computed(() => jackpotSats.value + roundJackpotContributionSats.value)

  // 本期（purchaseRound）收到的贊助頭獎總額——DonationMessageNFT.round 由合約寫入
  // 「捐款當下 JP.currentDrawRound + 1」，與本區塊其他「本輪」數字一樣，統一比對
  // purchaseRound（source of truth 是 RSA NFT 的 sellingRound）。這筆錢已經直接併入
  // playerDonation() 當下的 JP NFT value（見 JackpotPool.cash newJpValue），已經算在
  // jackpotSats 裡，這裡純粹是「本期」拆分顯示，不能再加總進 totalJackpotSats
  const roundDonationSats = computed(() =>
    donationEntries.value
      .filter(e => e.state.round === purchaseRound.value)
      .reduce((sum, e) => sum + e.state.donationTotal, 0n)
  )

  // 「結束本輪售票」成功後～「計算頭獎人數」完成前：上一輪還在開獎流程中，此時
  // purchaseRound 已經跳到下一期、但下一期的總獎金才剛開始累積（數字很小），
  // 所以前台改顯示「上一輪開獎中」，避免玩家看到一個過小、沒有吸引力的數字
  const drawingRoundActive = computed(() =>
    !!drawingNftState.value || !!wnAtJackpotPoolState.value || nextRoundHasShards.value
  )
  const drawingRoundNumber = computed(() => {
    if (drawingNftState.value) return drawingNftState.value.round
    if (wnAtJackpotPoolState.value) return wnAtJackpotPoolState.value.drawRound
    // nextRoundHasShards 要等第一次 settle() 才變 true；售票剛截止、尚未有人結算的
    // 空窗期（JackpotWidget 的 stage===2「結算中」）也要能對到目前這一輪的輪次號碼
    if (nextRoundHasShards.value || pastCutoff.value) return currentRound.value
    return null
  })
  // 開獎中的總獎金：enterDrawingPhase() 執行前，本輪票款還沒併入 JP，
  // 暫存在 RSC NFT 自己的面額裡（超過 DUST 的部分）——同樣尚未分帳，估算頭獎那一份；
  // 執行後 JP 已經是分帳完成的完整金額，直接顯示即可
  const drawingRoundTotalSats = computed(() => {
    if (drawingNftState.value || wnAtJackpotPoolState.value) return jackpotSats.value
    const sweptSats = rscValueSats.value > DUST ? rscValueSats.value - DUST : 0n
    return jackpotSats.value + estimateJackpotShare(sweptSats)
  })

  // Tier 1（熱資料）：RSA shard 銷量。玩家隨時買票都會變，且所有觀眾都要看到
  // 別人買票的即時進度，維持固定頻率輪詢，獨立於下面 Tier 2 的排程閘控之外。
  async function refreshHot(): Promise<void> {
    try {
      // 兩種篩選（currentRound／currentRound+1）查的是同一批 shardCount 個地址，一次查完、
      // 在記憶體裡篩兩次即可——合約規則保證 cutoffTime 前不可能有 round+1 的 shard，
      // 這裡不需要另外判斷 pastCutoff，篩不到自然是空陣列
      const allShards = await fetchAllRSAShardStates()
      const currentShards = allShards.filter(s => s.shardState.sellingRound === currentRound.value)
      const nextShards = allShards.filter(s => s.shardState.sellingRound === currentRound.value + 1)
      nextRoundHasShards.value = nextShards.length > 0
      // purchaseRound 的 shard 才是玩家「現在買票會進到哪裡」的即時票款；
      // 每個 shard 各自帶 1000 sats 協議 dust（settle()/aggregate() 鑄造時的下限，
      // 彙整滙入 RSC 時會被扣掉，見 RoundSwitchControl.cash aggregate() 的 `- DUST * ssCount`），
      // 不算玩家票款，顯示前先扣掉
      const purchaseRoundShards = nextRoundHasShards.value ? nextShards : currentShards
      rsaPoolSats.value = purchaseRoundShards.reduce(
        (sum, u) => sum + (u.valueSats > DUST ? u.valueSats - DUST : 0n),
        0n
      )
      purchaseRoundRate.value = purchaseRoundShards[0]?.shardState.exchangeRate ?? 0
      ticketsSoldThisRound.value = purchaseRoundShards.reduce(
        (sum, u) => sum + u.shardState.shardSalesCount,
        0
      )
      lastError.value = null
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  // Tier 2（冷資料）：RSC/JP/FPP/latestWN/DrawingNFT/WN-at-JP。這些只在明確的
  // 輪次狀態轉換時才變，售票期間讀到的值可以放心快取——見
  // docs/frontend_nft_polling_schedule_design.md。
  async function refreshCold(): Promise<void> {
    try {
      const [rsc, jp, fpp, wn, mtp, drawingNft, wnAtJp, configUtxo, donations] = await Promise.all([
        fetchRSCState(),
        fetchCurrentJackpotState(),
        fetchFixedPrizePoolBalance(),
        fetchLatestWinningNumber(),
        getBchMTP(),
        fetchDrawingNftState(),
        fetchWNAtJackpotPool(),
        fetchConfigUtxo(),
        fetchDonationMessageEntries(),
      ])
      rscState.value    = rsc.state
      rscValueSats.value = rsc.valueSats
      // JP NFT 自身也永遠帶 1000 sats 協議 dust（claimJackpot() 強制保留、從不發放給玩家，
      // 見 JackpotPool.cash `require(newJpValue >= 1000)`），顯示前扣掉
      const jpValueSats = jp?.valueSats ?? 0n
      jackpotSats.value = jpValueSats > DUST ? jpValueSats - DUST : 0n
      jpState.value     = jp?.state ?? null
      fppBalance.value  = fpp
      latestWn.value    = wn
      chainMtp.value    = mtp
      drawingNftState.value      = drawingNft
      wnAtJackpotPoolState.value = wnAtJp?.token?.nft ? parseWNCommitment(wnAtJp.token.nft.commitment) : null
      configState.value = parseConfigCommitment(configUtxo.token!.nft!.commitment)
      donationEntries.value = donations
      // isReady 一律要用這裡讀到的真實鏈上 MTP 判斷，本地排程只決定「什麼時候
      // 該重新讀一次」，不能取代這個判斷本身（見 roundSchedule.ts 頂部說明）
      pastCutoff.value = mtp >= rsc.state.cutoffTime

      // 結算進度：售票截止前不可能有分片已結算，省一次 64 位址掃描；兩批皆已彙整完成後
      // SS 全部重置回 phase=0，同樣必為 0，不必查詢。分批彙整（見規格書 6.3）期間
      // （aggregateBatchFlag===1，第一批已完成、等待第二批）lastAggregateTime 已經非 0，
      // 但仍要繼續掃描——此時查到的即是尚待第二批處理的剩餘分片數
      const fullyAggregated = rsc.state.lastAggregateTime !== 0n && rsc.state.aggregateBatchFlag === 0
      if (pastCutoff.value && !fullyAggregated) {
        const readyUtxos = await fetchAggregateReadySSUtxos(rsc.state.drawingRound)
        settledShardCount.value = readyUtxos.length
      } else {
        settledShardCount.value = 0
      }
      lastError.value = null
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  // 使用者操作（買票、四個 permissionless trigger、領獎）後呼叫的完整刷新——
  // 維持原本「兩者都讀一次」的相容介面，不受 Tier 2 排程檔位影響
  async function refresh(): Promise<void> {
    loading.value = true
    try {
      await refreshCold()
      await refreshHot()
    } finally {
      loading.value = false
    }
  }

  let coldTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleNextColdRefresh(): void {
    if (coldTimer) clearTimeout(coldTimer)
    // 尚未校準過（例如啟動時第一次 refreshCold 就失敗）：完全沒有排程依據，
    // 用最快檔位盡快重試，取得第一筆基準狀態
    const tier = rscState.value
      ? currentTier({
          cutoffTime: rscState.value.cutoffTime,
          pastCutoff: pastCutoff.value,
          drawingRoundActive: drawingRoundActive.value,
          estimatedNow: BigInt(Math.floor(Date.now() / 1000)),
        })
      : 'imminent'
    coldTimer = setTimeout(async () => {
      await refreshCold()
      scheduleNextColdRefresh()
    }, TIER_INTERVAL_MS[tier])
  }

  // App.vue 啟動時呼叫一次：校準完成後開始 Tier 2 的動態排程輪詢
  function startColdSchedule(): void {
    scheduleNextColdRefresh()
  }

  // ─── 樂觀更新 ────────────────────────────────────────────────────────────────
  // 以下 apply* 函式由各 permissionless trigger 的 composable 在交易「廣播成功」的
  // 當下直接呼叫，用交易本身已經算好的新 commitment 內容更新畫面，不必等
  // electrum 重新索引（可能落後數秒～數十秒）。背景的 Tier 2 冷資料排程仍會照常
  // 定期 refreshCold()，作為最終一致性的保險，這裡不需要也不應該額外觸發它。

  // settle() 每次只結算一個分片、可批次併發送出多筆獨立交易——收到幾筆成功就加幾筆，
  // 不需要重建 rscState（settle() 完全不動 RSC，只動被結算分片自己的 RSA/SS）
  function applySettle(successCount: number): void {
    settledShardCount.value += successCount
  }

  function applyAggregate(rsc: RSCNftState, newRscValueSats: bigint): void {
    rscState.value = rsc
    rscValueSats.value = newRscValueSats
    // 彙整完成後全部 64 張 SS 已重置回待結算狀態（供下一波使用），本輪進度歸零
    settledShardCount.value = 0
  }

  function applyEnterDrawingPhase(
    rsc: RSCNftState, newRscValueSats: bigint,
    drawing: DrawingNftState, jp: JPNftState, newJackpotSats: bigint
  ): void {
    rscState.value = rsc
    rscValueSats.value = newRscValueSats
    drawingNftState.value = drawing
    jpState.value = jp
    jackpotSats.value = newJackpotSats
    pastCutoff.value = chainMtp.value >= rsc.cutoffTime
    settledShardCount.value = 0
  }

  function applyDraw(rsc: RSCNftState, wn: WNNftState): void {
    rscState.value = rsc
    drawingNftState.value = null
    wnAtJackpotPoolState.value = wn
    latestWn.value = wn
  }

  function applyVerifyWin(jp: JPNftState, newJackpotSats: bigint): void {
    wnAtJackpotPoolState.value = null
    jpState.value = jp
    jackpotSats.value = newJackpotSats
  }

  function applyCancelDraw(jp: JPNftState, newJackpotSats: bigint): void {
    drawingNftState.value = null
    jpState.value = jp
    jackpotSats.value = newJackpotSats
  }

  return { rscState, jackpotSats, rsaPoolSats, ticketsSoldThisRound, roundJackpotContributionSats,
           roundDonationSats, totalJackpotSats, jpState, fppBalance, latestWn, loading, lastError,
           nextRoundHasShards, currentRound, cutoffTime, bchUsdRate, purchaseRoundRate, purchaseRound,
           chainMtp, pastCutoff, drawingNftState, wnAtJackpotPoolState, configState,
           settledShardCount, aggregateReady, aggregated, aggregateBatchInProgress,
           drawingRoundActive, drawingRoundNumber, drawingRoundTotalSats,
           refresh, refreshHot, refreshCold, startColdSchedule,
           applySettle, applyAggregate, applyEnterDrawingPhase, applyDraw, applyVerifyWin,
           applyCancelDraw }
})

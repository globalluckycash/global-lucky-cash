<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-2">{{ t('draw_process.page_title') }}</h1>
      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-10 text-sm">
        <i class="fa-solid fa-route text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('draw_process.page_subtitle') }}</p>
      </div>

      <!-- 正常流程 -->
      <section class="mb-12">
        <div class="flex items-center gap-3 mb-2">
          <i class="fa-solid fa-dice text-bch"></i>
          <h2 class="text-xl font-black italic">{{ t('trigger.section_title') }}</h2>
        </div>
        <p class="text-gray-500 text-sm mb-6">{{ t('trigger.section_desc') }}</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <TriggerCard
            :title="t('trigger.settle')"
            :hint="t('trigger.settle_hint')"
            :sdk-url="sdkUrls.settle"
            :time-label="cutoffTimeLabel"
            time-kind="mtp"
            :progress-done="contractStore.settledShardCount"
            :progress-total="shardCount"
            :is-ready="settleReady"
            :is-waiting="settleWaiting"
            :tx-state="settleState"
            @execute="executeSettle"
          />
          <TriggerCard
            :title="t('trigger.aggregate')"
            :hint="t('trigger.aggregate_hint')"
            :sdk-url="sdkUrls.aggregate"
            :progress-done="aggBatchDone"
            :progress-total="aggBatchTotal"
            :is-ready="aggReady"
            :tx-state="aggState"
            @execute="executeAggregate"
          />
          <TriggerCard
            :title="t('trigger.enter_draw')"
            :hint="t('trigger.enter_draw_hint')"
            :sdk-url="sdkUrls.enterDrawingPhase"
            :is-ready="edpReady"
            :tx-state="edpState"
            @execute="executeEnterDrawingPhase"
          />
          <TriggerCard
            :title="t('trigger.draw')"
            :hint="t('trigger.draw_hint')"
            :sdk-url="sdkUrls.draw"
            :time-label="drawTimeLabel"
            time-kind="realtime"
            :is-ready="drawReady"
            :is-waiting="drawWaiting"
            :tx-state="drawState"
            @execute="executeDraw"
          />
          <TriggerCard
            :title="t('trigger.verify_win')"
            :hint="t('trigger.verify_win_hint')"
            :sdk-url="sdkUrls.verifyWin"
            :is-ready="!!contractStore.wnAtJackpotPoolState"
            :tx-state="vwState"
            @execute="executeVerifyWin"
          />
        </div>
      </section>

      <!-- 例外處理 -->
      <section>
        <div class="flex items-center gap-3 mb-2">
          <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
          <h2 class="text-xl font-black italic">{{ t('trigger.exception_section_title') }}</h2>
        </div>
        <p class="text-gray-500 text-sm mb-4">{{ t('trigger.exception_section_desc') }}</p>

        <div class="flex items-start gap-2.5 mb-6 px-4 py-3 rounded-xl bg-bch/5 border border-bch/25 text-bch text-xs leading-relaxed">
          <i class="fa-solid fa-shield-halved mt-0.5 shrink-0"></i>
          <span>{{ t('trigger.exception_refund_note') }}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <TriggerCard
            tone="warning"
            :title="t('trigger.cancel_draw')"
            :hint="t('trigger.cancel_draw_hint')"
            :sdk-url="sdkUrls.cancelDraw"
            :is-ready="cdReady"
            :tx-state="cdState"
            @execute="executeCancelDraw"
          />
        </div>
      </section>
    </div>
  </div>

  <DrawResultModal
    :visible="showResultModal"
    :result="lastDrawResult"
    @close="showResultModal = false"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TriggerCard from '@/components/TriggerCard.vue'
import DrawResultModal from '@/components/DrawResultModal.vue'
import { useContractStore } from '@/stores/contract'
import { useSettle } from '@/composables/useSettle'
import { useAggregate } from '@/composables/useAggregate'
import { useEnterDrawingPhase } from '@/composables/useEnterDrawingPhase'
import { useDraw, type DrawResult } from '@/composables/useDraw'
import { useVerifyWin } from '@/composables/useVerifyWin'
import { useCancelDraw } from '@/composables/useCancelDraw'
import {
  fetchWNAtJackpotPool,
  fetchAllJackpotPools,
  fetchRSCUtxo,
  fetchNSByLotteryNumber,
} from '@/lib/electrum'
import { parseWNCommitment } from '@/lib/nftDecode'
import { useToast } from '@/composables/useToast'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { getComposableSourceUrl } from '@/lib/contractConfig'

const { t } = useI18n()
const contractStore = useContractStore()
const { showToast } = useToast()

useLiveRefresh()

// 六個操作各自對應的 SDK 腳本，供 TriggerCard 標題旁的原始碼提示連結使用
const sdkUrls = {
  settle: getComposableSourceUrl('useSettle.ts'),
  aggregate: getComposableSourceUrl('useAggregate.ts'),
  enterDrawingPhase: getComposableSourceUrl('useEnterDrawingPhase.ts'),
  draw: getComposableSourceUrl('useDraw.ts'),
  verifyWin: getComposableSourceUrl('useVerifyWin.ts'),
  cancelDraw: getComposableSourceUrl('useCancelDraw.ts'),
}

function formatDateTime(ts: bigint | number | undefined): string {
  if (!ts) return '--'
  const d = new Date(Number(ts) * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ─── 正常流程 ───────────────────────────────────────────────────────────────

const shardCount = computed(() => contractStore.configState?.shardCount ?? 0)

// Settle（一鍵結算所有已達截止售票時間的分片）
const { state: settleState, isReady: settleReady, execute: settleExecute, reset: settleReset } = useSettle()
const cutoffTimeLabel = computed(() => formatDateTime(contractStore.rscState?.cutoffTime))
// 尚未就緒、且唯一卡住的原因是鏈上時間還沒到截止時間 —— 醒目提示玩家「即將可執行」
const settleWaiting = computed(() => !settleReady.value && !!contractStore.cutoffTime && !contractStore.pastCutoff)

// Aggregate（全部分片結算完成後，一次彙整）
const { state: aggState, isReady: aggReady, execute: aggExecute, reset: aggReset, batchDone: aggBatchDone, batchTotal: aggBatchTotal } = useAggregate()

// Enter Drawing Phase
const { state: edpState, isReady: edpReady, execute: edpExecute, reset: edpReset } = useEnterDrawingPhase()

// Draw
const { state: drawState, execute: drawExecute, reset: drawReset, result: drawResult } = useDraw()
const drawReady = computed(() => {
  if (!contractStore.drawingNftState) return false
  if (contractStore.drawingNftState.cumulativeSales === 0n) return false
  return BigInt(Math.floor(Date.now() / 1000)) >= contractStore.drawingNftState.expectedDrawTime
})
// 已進入開獎階段、但唯一卡住的原因是還沒到預計開獎時間 —— 醒目提示玩家「即將可執行」
const drawWaiting = computed(() => !!contractStore.drawingNftState && contractStore.drawingNftState.cumulativeSales !== 0n && !drawReady.value)
const drawTimeLabel = computed(() => formatDateTime(contractStore.drawingNftState?.expectedDrawTime))
const showResultModal = ref(false)
const lastDrawResult = ref<DrawResult | null>(null)

// Verify Win
const { state: vwState, execute: vwExecute, reset: vwReset } = useVerifyWin()

async function executeSettle() {
  try {
    await settleExecute()
    if (settleState.status === 'success') {
      // settle() 逐片獨立送出，部分分片失敗不影響其他已成功的分片，仍算整批成功，
      // 但要另外提示有幾片失敗，供使用者評估是否要再次觸發
      if (settleState.failed > 0) {
        showToast(`${settleState.done}/${settleState.total} 個售票合約結算成功，${settleState.failed} 個失敗：${settleState.error ?? ''}`, 'warning')
      } else {
        showToast(t('toast.tx_broadcast'), 'success')
      }
      settleReset()
    } else if (settleState.status === 'error') {
      showToast(settleState.error ?? t('errors.unknown_error'), 'error')
      settleReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}

async function executeAggregate() {
  try {
    await aggExecute()
    if (aggState.status === 'success') {
      showToast(t('toast.tx_broadcast'), 'success')
      aggReset()
    } else if (aggState.status === 'error') {
      showToast(aggState.error ?? t('errors.unknown_error'), 'error')
      aggReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}

async function executeEnterDrawingPhase() {
  try {
    await edpExecute()
    if (edpState.status === 'success') {
      showToast(t('toast.tx_broadcast'), 'success')
      edpReset()
    } else if (edpState.status === 'error') {
      showToast(edpState.error ?? t('errors.unknown_error'), 'error')
      edpReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}

async function executeDraw() {
  try {
    await drawExecute()
    if (drawState.status === 'success') {
      lastDrawResult.value = drawResult.value
      showResultModal.value = true
      drawReset()
    } else if (drawState.status === 'error') {
      showToast(drawState.error ?? t('errors.unknown_error'), 'error')
      drawReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}

async function executeVerifyWin() {
  try {
    const wnUtxo = await fetchWNAtJackpotPool()
    if (!wnUtxo?.token?.nft) throw new Error('WN not at JackpotPool')

    const wn = parseWNCommitment(wnUtxo.token.nft.commitment)
    const nsUtxo = await fetchNSByLotteryNumber(wn.n1, wn.n2, wn.n3, wn.s)
    const rscUtxo = await fetchRSCUtxo()

    const allJp = await fetchAllJackpotPools()
    const jpEntry = allJp.find(j => j.state.winnerCount === 0)
    if (!jpEntry) throw new Error('Accumulating JackpotPool not found')

    await vwExecute({ jpUtxo: jpEntry.utxo, wnUtxo, nsUtxo, rscUtxo })
    if (vwState.status === 'success') {
      showToast(t('toast.tx_broadcast'), 'success')
      vwReset()
    } else if (vwState.status === 'error') {
      showToast(vwState.error ?? t('errors.unknown_error'), 'error')
      vwReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}

// ─── 例外處理 ───────────────────────────────────────────────────────────────
// 取消開獎卡片永遠顯示，讓玩家知道流程有可能因此被取消。換輪停滯的取消/復原機制
// （原「取消本輪售票」「分片復原」）已隨結算/彙整改版移除，見規格書 3.1、6.3。

const { state: cdState, isReady: cdReady, execute: cdExecute, reset: cdReset } = useCancelDraw()

async function executeCancelDraw() {
  try {
    await cdExecute()
    if (cdState.status === 'success') {
      showToast(t('toast.tx_broadcast'), 'success')
      cdReset()
    } else if (cdState.status === 'error') {
      showToast(cdState.error ?? t('errors.unknown_error'), 'error')
      cdReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}
</script>

<template>
  <!-- Single unified hero card: round + sale progress/draw-process status + jackpot all in one prominent unit -->
  <div class="max-w-2xl mx-auto rounded-[2rem] bg-gradient-to-b from-white/[0.07] to-white/[0.02] border border-bch/20 shadow-neon-strong overflow-hidden">
    <!-- Header row: which round you're buying into + current stage label -->
    <div class="flex flex-wrap items-center justify-between gap-3 px-6 md:px-10 pt-6">
      <Transition name="round-pop" mode="out-in">
        <div :key="purchaseRound" class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-bch text-black font-black text-sm md:text-base tracking-tight shadow-neon-strong">
          <i class="fa-solid fa-ticket text-black/60 text-xs"></i>
          {{ t('hero.round_label', { round: purchaseRound }) }}
          <!-- 上一輪還在開獎流程中時，右側改顯示上一輪的「開獎中」徽章，
               這裡補一個「售票中」字樣避免玩家誤以為右側狀態也是在講這一期 -->
          <span v-if="roundsDiverged" class="text-[10px] font-black bg-black/15 px-1.5 py-0.5 rounded-full">
            {{ t('hero.stage_pill_selling') }}
          </span>
        </div>
      </Transition>
      <div class="inline-flex items-center gap-2 text-xs font-bold" :style="{ color: pillColor }">
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" :style="{ backgroundColor: pillColor }"></span>
          <span class="relative inline-flex rounded-full h-2 w-2" :style="{ backgroundColor: pillColor }"></span>
        </span>
        <span>{{ stage > 1 ? t('hero.drawing_badge', { round: drawingRoundNumber }) : pillLabel }}</span>
      </div>
    </div>

    <!-- Stage 1（售票中）：MTP 售票進度，取代原本的秒數倒數 -->
    <div v-if="stage === 1" class="relative px-6 md:px-10 py-6 overflow-hidden">
      <!-- 氛圍光暈：緩慢飄移的裝飾光斑，讓售票中畫面多一點生氣與色彩 -->
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        <div class="ambient-blob ambient-blob-a"></div>
        <div class="ambient-blob ambient-blob-b"></div>
      </div>

      <div class="relative z-10">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs uppercase tracking-widest text-gray-400 font-bold flex items-center gap-1.5">
            {{ t('hero.sale_progress_label') }}
          </span>
          <span class="pct-pulse countdown-display font-black text-bch text-lg [text-shadow:0_0_10px_rgba(10,193,142,0.65)]">{{ saleProgressPct.toFixed(0) }}%</span>
        </div>
        <div class="relative flex gap-[3px] h-5 rounded-lg overflow-hidden bg-black/30 p-[3px]">
          <div v-for="i in SEGMENTS" :key="i"
            class="seg flex-1 rounded-[3px]"
            :class="i <= filledSegments ? 'bg-gradient-to-r from-bch to-bch-glow shadow-[0_0_6px_rgba(10,193,142,0.8)]' : 'bg-white/10'"
          ></div>
          <div class="progress-shimmer absolute inset-0 pointer-events-none"></div>
        </div>
        <div class="flex justify-between items-start mt-2 text-[10px] text-gray-600 font-mono uppercase tracking-wider">
          <div class="text-left">
            <div>{{ t('hero.sale_start_label') }}</div>
            <div class="mt-1 inline-flex items-center gap-1 normal-case tracking-normal">
              <span class="text-white/80 font-bold">{{ formatMtp(saleStartTime) }}</span>
              <span class="px-1 py-0.5 rounded bg-white/10 text-[8px] text-gray-400 font-bold">MTP</span>
            </div>
          </div>
          <div class="text-right">
            <div>{{ t('hero.sale_cutoff_label') }}</div>
            <div class="mt-1 inline-flex items-center gap-1 normal-case tracking-normal">
              <span class="text-white/80 font-bold">{{ formatMtp(rscState.cutoffTime) }}</span>
              <span class="px-1 py-0.5 rounded bg-white/10 text-[8px] text-gray-400 font-bold">MTP</span>
            </div>
          </div>
        </div>

        <!-- 雙時鐘儀表卡：鏈上 MTP（固定，僅隨鏈上輪詢更新，綠色調）／目前真實時間（逐秒讀秒，藍色調＋跳動燈號） -->
        <div class="grid grid-cols-2 gap-3 mt-5 max-w-sm mx-auto">
          <div class="rounded-xl bg-bch/5 border border-bch/25 px-3 py-2.5 text-center">
            <div class="text-[9px] uppercase tracking-wider text-bch/70 flex items-center justify-center gap-1">
              <i class="fa-solid fa-link"></i> {{ t('hero.chain_mtp_label') }}
            </div>
            <div class="countdown-display text-sm text-bch font-bold mt-1">{{ formatMtp(chainMtp) }}</div>
          </div>
          <div class="rounded-xl bg-sky-400/5 border border-sky-400/25 px-3 py-2.5 text-center">
            <div class="text-[9px] uppercase tracking-wider text-sky-300/80 flex items-center justify-center gap-1">
              <span class="relative flex h-1.5 w-1.5">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-400"></span>
              </span>
              {{ t('hero.real_time_label') }}
            </div>
            <div class="countdown-display text-sm text-sky-300 font-bold mt-1">{{ formatMtp(liveNow) }}</div>
          </div>
        </div>
        <div class="text-center mt-3 text-xs text-gray-500">{{ t('hero.sale_remaining_hint', { duration: remainingCoarseLabel }) }}</div>
      </div>
    </div>

    <div class="border-t border-white/10 mx-6 md:mx-10"></div>

    <!-- Jackpot total: 開獎中(結束售票～計算頭獎人數之間)改顯示上一輪開獎狀態，
         避免玩家看到剛切輪、還沒開始累積的下一輪金額，數字太小沒有吸引力。
         用 stage > 1 而非 drawingRoundActive 判斷——後者要等第一次 settle() 後才變 true，
         售票剛截止、尚未有人結算的空窗期 stage 已經是 2，若用 drawingRoundActive 會讓
         整條旅程軸（含圖示）在這段空窗期消失，退回顯示純數字 -->
    <div v-if="stage > 1" class="relative text-center px-6 md:px-10 py-8 bg-gradient-to-b from-amber-500/10 to-transparent">
      <div ref="confettiBoxRef" class="absolute inset-0 overflow-hidden pointer-events-none"></div>
      <div class="relative z-10">
        <div class="text-amber-200/80 text-sm uppercase tracking-widest mb-2 font-semibold">
          {{ t('hero.drawing_jackpot_label', { round: drawingRoundNumber }) }}
        </div>
        <div class="text-5xl md:text-6xl font-black text-amber-400 mb-2">
          {{ formatBch(drawingRoundTotalSats) }} <span class="text-2xl">BCH</span>
        </div>
        <div class="text-white/30 font-mono text-sm">
          ≈ ${{ formatUsd(drawingRoundTotalSats, rscState.stagedRate) }} USD
        </div>

        <!-- 進度旅程軸：結束售票 → 統計總票數 → 準備開獎 → 等待時刻 → 開獎 → 計算頭獎人數 -->
        <div class="mt-8 pt-8 border-t border-white/10">
          <div class="flex items-center max-w-lg mx-auto mb-10 px-2">
            <template v-for="(node, idx) in JOURNEY_NODES" :key="node.stage">
              <div class="journey-node" :class="nodeStatusClass(node.stage)" :style="nodeStyle(node.stage)">
                <i :class="node.icon" class="text-xs"></i>
                <span class="journey-label">{{ t(node.labelKey) }}</span>
              </div>
              <div v-if="idx < JOURNEY_NODES.length - 1" class="journey-line" :class="{ done: stage > node.stage }"></div>
            </template>
          </div>

          <!-- Stage 2：已達截止，可以結束本輪售票 -->
          <div v-if="stage === 2" class="text-center">
            <div class="font-black text-xl text-white mb-1">{{ t('hero.stage2_title') }}</div>
            <div class="text-xs text-gray-500 mb-4">{{ t('hero.stage2_desc') }}</div>
            <router-link to="/draw-process" class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold text-gray-300 inline-flex items-center gap-1.5">
              {{ t('hero.goto_draw_process') }} <i class="fa-solid fa-arrow-right text-[10px]"></i>
            </router-link>
          </div>

          <!-- Stage 3：統計總票數中 -->
          <div v-else-if="stage === 3">
            <div class="text-center mb-3">
              <div class="font-black text-xl text-white mb-1">{{ t('hero.stage3_title') }}</div>
              <div class="text-xs text-gray-500">{{ t('hero.stage3_desc') }}</div>
            </div>
            <div class="flex items-center justify-between mb-1 max-w-xs mx-auto">
              <span class="text-[10px] text-gray-500 uppercase tracking-wider">{{ t('hero.stage3_progress_label') }}</span>
              <span class="countdown-display font-black text-sky-400">{{ settledShardCount }} / {{ shardCount }}</span>
            </div>
            <div class="flex gap-[2px] h-3 rounded-md overflow-hidden bg-black/30 p-[2px] max-w-xs mx-auto">
              <div v-for="i in MINI_SEGMENTS" :key="i"
                class="seg flex-1 rounded-[3px]"
                :class="i <= filledMiniSegments ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]' : 'bg-white/10'"
              ></div>
            </div>
          </div>

          <!-- Stage 4：統計完成，尚未進入開獎階段 -->
          <div v-else-if="stage === 4" class="text-center">
            <div class="font-black text-xl text-white mb-1">{{ t('hero.stage4_title') }}</div>
            <div class="text-xs text-gray-500 mb-4">{{ t('hero.stage4_desc') }}</div>
            <router-link to="/draw-process" class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold text-gray-300 inline-flex items-center gap-1.5">
              {{ t('hero.goto_draw_process') }} <i class="fa-solid fa-arrow-right text-[10px]"></i>
            </router-link>
          </div>

          <!-- Stage 5：開獎時間已產生，等待到達（真實時間倒數——oracle 報價時間，非 MTP） -->
          <div v-else-if="stage === 5" class="text-center">
            <div class="text-gray-400 text-xs uppercase tracking-widest font-semibold mb-2">{{ t('hero.stage5_label') }}</div>
            <div class="countdown-display text-3xl md:text-4xl font-black text-white">{{ drawCountdownDisplay }}</div>
            <div class="text-xs text-gray-500 mt-2">{{ t('hero.stage5_desc') }}</div>
          </div>

          <!-- Stage 6：可執行開獎（首頁唯一保留的直接操作） -->
          <div v-else-if="stage === 6" class="text-center">
            <div class="relative w-16 h-16 mx-auto mb-4">
              <span class="lotto-ball lotto-ball-bounce absolute left-0 top-3 w-8 h-8 bg-bch text-black text-xs shadow-neon">?</span>
              <span class="lotto-ball absolute right-0 top-0 w-8 h-8 bg-purple-500 text-white text-sm shadow-[0_0_10px_rgba(168,85,247,0.7)]">★</span>
              <span class="lotto-ball lotto-ball-bounce absolute left-3 bottom-0 w-8 h-8 bg-bch text-black text-xs shadow-neon" style="animation-delay:0.3s">?</span>
            </div>
            <div class="font-black text-xl text-white mb-4">{{ t('hero.stage6_title') }}</div>
            <button
              type="button"
              :disabled="drawState.status !== 'idle'"
              @click="$emit('execute-draw')"
              class="w-full sm:w-auto px-8 py-4 rounded-2xl font-black text-base uppercase tracking-wide transition inline-flex items-center justify-center gap-2 mx-auto bg-gradient-to-r from-bch to-bch-glow text-black shadow-neon-strong animate-glow-pulse hover:scale-[1.03] disabled:opacity-60 disabled:cursor-not-allowed disabled:animate-none"
            >
              <template v-if="isDrawBusy">
                <i class="fa-solid fa-gear spinner"></i>
                {{ drawSpinnerLabel }}
              </template>
              <template v-else>
                <i class="fa-solid fa-star"></i>
                {{ t('trigger.execute') }}
              </template>
            </button>
          </div>

          <!-- Stage 7：計算頭獎人數中（verifyWin，沿用既有 trigger.verify_win 用語） -->
          <div v-else-if="stage === 7" class="text-center">
            <div class="font-black text-lg text-white mb-1">{{ t('hero.stage7_title') }}</div>
            <div class="text-xs text-gray-500 mb-4">{{ t('hero.stage7_desc') }}</div>
            <router-link to="/draw-process" class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold text-gray-300 inline-flex items-center gap-1.5">
              {{ t('hero.goto_draw_process') }} <i class="fa-solid fa-arrow-right text-[10px]"></i>
            </router-link>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="text-center px-6 md:px-10 py-8">
      <div class="text-gray-400 text-sm uppercase tracking-widest mb-2 font-semibold">
        {{ t('hero.jackpot_label', { round: purchaseRound }) }}
      </div>
      <div class="text-5xl md:text-6xl font-black text-bch mb-2">
        {{ formatBch(totalJackpotSats) }} <span class="text-2xl">BCH</span>
      </div>
      <div class="text-white/30 font-mono text-sm">
        ≈ ${{ formatUsd(totalJackpotSats, rscState.stagedRate) }} USD
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCountdown } from '@/composables/useCountdown'
import { useLiveClock } from '@/composables/useLiveClock'
import type { RSCNftState, DrawingNftState, TxState } from '@/types'

const { t } = useI18n()

const props = defineProps<{
  rscState: RSCNftState
  // JP NFT 累積金額 + 當期 RSA shard 票款總和
  totalJackpotSats: bigint
  purchaseRound: number
  // 鏈上 MTP——狀態①的售票進度與雙時鐘顯示都以這個為準，不能用 Date.now()
  chainMtp: bigint
  // ConfigNFT.roundPeriod（秒）——本輪售票起點 = cutoffTime − roundPeriod（見 genesis 排程設計）
  roundPeriod: number
  // 上一輪是否還在開獎流程中（結算～計算頭獎人數之間）
  drawingRoundActive: boolean
  drawingRoundNumber: number | null
  drawingRoundTotalSats: bigint
  drawingNftState: DrawingNftState | null
  // WinningNumberNFT 是否還在 JackpotPool 等待 verifyWin（狀態⑦：計算頭獎人數中）
  verifyPending: boolean
  drawState: TxState
  // 已完成結算（ShardSettlementNFT.phase===1）的分片數（狀態③結算進度）
  settledShardCount: number
  // 本輪是否已彙整完成（狀態④，等待進入開獎階段）
  aggregated: boolean
}>()

defineEmits<{ 'execute-draw': [] }>()

const shardCount = parseInt(import.meta.env.VITE_SHARD_COUNT ?? '64', 10)
const SEGMENTS = 24
const MINI_SEGMENTS = 24

const STAGE_TONE: Record<number, string> = {
  1: '#0AC18E', 2: '#fbbf24', 3: '#38bdf8', 4: '#a78bfa', 5: '#60a5fa', 6: '#facc15', 7: '#2dd4bf',
}
// 只有 stage 1（售票中）需要獨立文案；stage>1 一律由 header 徽章顯示「第 X 期開獎中」
// （見上方 template 的 stage>1 三元判斷），細節階段交給旅程軸與卡片內文表達，
// pillLabel 不會再被讀到，故 stage 2~7 沒有對應 pill 文案可寫
const STAGE_PILL_KEY: Record<number, string> = {
  1: 'hero.stage_pill_selling',
}
const JOURNEY_NODES = [
  { stage: 2, icon: 'fa-solid fa-flag-checkered', labelKey: 'hero.node_settle' },
  { stage: 3, icon: 'fa-solid fa-list-check', labelKey: 'hero.node_tally' },
  { stage: 4, icon: 'fa-solid fa-hourglass-half', labelKey: 'hero.node_prepare_draw' },
  { stage: 5, icon: 'fa-solid fa-clock', labelKey: 'hero.node_await_draw' },
  { stage: 6, icon: 'fa-solid fa-star', labelKey: 'hero.node_draw' },
  { stage: 7, icon: 'fa-solid fa-magnifying-glass', labelKey: 'hero.node_verify' },
] as const

const { now: liveNow } = useLiveClock()

const drawTarget = computed(() => props.drawingNftState?.expectedDrawTime ?? 0n)
const { display: drawCountdownDisplay, remaining: drawRemaining } = useCountdown(drawTarget)
const drawReady = computed(() => !!props.drawingNftState && drawRemaining.value <= 0)

const pastCutoff = computed(() => props.chainMtp >= props.rscState.cutoffTime)

// 判斷順序很重要：verifyPending/drawingNftState/aggregated/settledShardCount 都是「上一輪
// 開獎流程還在進行中」的直接證據，必須優先於 pastCutoff 判斷——因為 enterDrawingPhase()
// 執行後會把 rscState.cutoffTime 推進到下一輪，導致 pastCutoff 在上一輪開獎流程跑完前就
// 先變回 false，若 pastCutoff 排最前面會讓 stage 誤鎖回 1，使旅程軸整排節點都亮不起來
const stage = computed<number>(() => {
  if (props.verifyPending) return 7
  if (props.drawingNftState) return drawReady.value ? 6 : 5
  if (props.aggregated || props.settledShardCount >= shardCount) return 4
  if (props.settledShardCount > 0) return 3
  if (!pastCutoff.value) return 1
  return 2
})

const pillColor = computed(() => STAGE_TONE[stage.value])
const pillLabel = computed(() => t(STAGE_PILL_KEY[stage.value]))

// 上一輪開獎流程還在跑、但下一輪已經有玩家買票（購買期數已推進）時，
// header 右側的階段燈號其實是在講上一輪，必須明確標示期數，
// 否則會跟左側「第 N 期」的購買期數徽章擠在同一列，讓玩家誤以為是同一期
const roundsDiverged = computed(() =>
  props.drawingRoundActive && props.drawingRoundNumber !== null && props.drawingRoundNumber !== props.purchaseRound
)

// 本輪售票起點＝上一輪的截止時間（本輪 cutoffTime 往前推一個 roundPeriod）；
// 100% = 本輪 cutoffTime，也就是本輪售票結束的那一刻
const saleStartTime = computed(() => props.rscState.cutoffTime - BigInt(props.roundPeriod))

const saleProgressPct = computed(() => {
  const total = Number(props.rscState.cutoffTime - saleStartTime.value)
  if (total <= 0) return 0
  const elapsed = Number(props.chainMtp - saleStartTime.value)
  return Math.max(0, Math.min(100, (elapsed / total) * 100))
})

const filledSegments = computed(() => Math.round((saleProgressPct.value / 100) * SEGMENTS))

const tallyPct = computed(() => shardCount > 0 ? (props.settledShardCount / shardCount) * 100 : 0)
const filledMiniSegments = computed(() => Math.round((Math.max(0, Math.min(100, tallyPct.value)) / 100) * MINI_SEGMENTS))

const remainingCoarseLabel = computed(() =>
  formatCoarseDuration(Number(props.rscState.cutoffTime - props.chainMtp))
)

function formatCoarseDuration(totalSeconds: number): string {
  const hours = Math.max(0, totalSeconds) / 3600
  if (hours < 1) return t('hero.duration_lt_1h')
  if (hours < 48) return t('hero.duration_hours', { n: hours.toFixed(1) })
  return t('hero.duration_days', { n: (hours / 24).toFixed(1) })
}

function nodeStatusClass(nodeStage: number): string {
  if (stage.value > nodeStage) return 'done'
  if (stage.value === nodeStage) return 'current'
  return 'future'
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function nodeStyle(nodeStage: number) {
  if (stage.value !== nodeStage) return {}
  const hex = STAGE_TONE[nodeStage]
  return {
    borderColor: hex,
    color: hex,
    background: hexToRgba(hex, 0.15),
    boxShadow: `0 0 16px ${hexToRgba(hex, 0.55)}`,
  }
}

const isDrawBusy = computed(() =>
  ['building', 'awaiting_signature', 'broadcasting'].includes(props.drawState.status)
)

const drawSpinnerLabel = computed(() => {
  if (props.drawState.status === 'building') return 'building...'
  if (props.drawState.status === 'awaiting_signature') return 'awaiting signature...'
  return 'broadcasting...'
})

// 彩帶慶祝：進入狀態⑥（可開獎）時噴出一次，不隨每次重新渲染重複觸發
const confettiBoxRef = ref<HTMLElement | null>(null)
const CONFETTI_COLORS = ['#facc15', '#0AC18E', '#38bdf8', '#f472b6', '#a78bfa']

function spawnConfetti() {
  const box = confettiBoxRef.value
  if (!box) return
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('span')
    p.className = 'confetti-piece'
    p.style.left = `${Math.random() * 100}%`
    p.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px'
    p.style.animationDuration = `${1.2 + Math.random() * 0.8}s`
    p.style.animationDelay = `${Math.random() * 0.4}s`
    box.appendChild(p)
    setTimeout(() => p.remove(), 2200)
  }
}

watch(stage, (val, oldVal) => {
  if (val === 6 && oldVal !== 6) spawnConfetti()
})

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatMtp(ts: bigint | number): string {
  const d = new Date(Number(ts) * 1000)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatBch(sats: bigint): string {
  return (Number(sats) / 1e8).toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 })
}

// rate = USD/BCH × 100 (e.g. 45000 → 1 BCH = 450.00 USD)
function formatUsd(sats: bigint, rate: number): string {
  if (!rate) return '0.00'
  const bch = Number(sats) / 1e8
  const usd = bch * (rate / 100)
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<style scoped>
.round-pop-enter-active {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
}
.round-pop-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.round-pop-enter-from {
  opacity: 0;
  transform: scale(0.6) translateY(8px);
}
.round-pop-leave-to {
  opacity: 0;
  transform: scale(0.85);
}

.countdown-display { font-family: 'Space Mono', monospace; font-weight: 700; }
.seg { transition: background-color 0.4s ease, box-shadow 0.4s ease; }

/* 售票中氛圍光暈：低調飄移的雙色光斑 */
.ambient-blob {
  position: absolute;
  border-radius: 9999px;
  filter: blur(36px);
  opacity: 0.35;
}
.ambient-blob-a {
  width: 200px; height: 200px;
  top: -60px; left: -40px;
  background: radial-gradient(circle, rgba(10, 193, 142, 0.6), transparent 70%);
  animation: blob-drift-a 9s ease-in-out infinite;
}
.ambient-blob-b {
  width: 170px; height: 170px;
  bottom: -50px; right: -30px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.45), transparent 70%);
  animation: blob-drift-b 11s ease-in-out infinite;
}
@keyframes blob-drift-a {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(18px, 14px) scale(1.15); }
}
@keyframes blob-drift-b {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-14px, -10px) scale(1.1); }
}

/* 進度條掃光效果，讓售票進度感覺持續在動 */
.progress-shimmer {
  background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
  background-size: 200% 100%;
  animation: shimmer-sweep 2.6s ease-in-out infinite;
}
@keyframes shimmer-sweep {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 售票進度百分比：輕微呼吸感 */
.pct-pulse { display: inline-block; animation: pct-breathe 2.4s ease-in-out infinite; }
@keyframes pct-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

/* 旅程軸節點 */
.journey-node {
  width: 2.6rem; height: 2.6rem; border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  border-width: 2px; border-style: solid; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative; z-index: 1; flex-shrink: 0;
}
.journey-line { flex: 1; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.1); transition: background 0.5s ease; margin: 0 2px; }
.journey-node.future { border-color: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.3); background: transparent; }
.journey-node.done { border-color: #0AC18E; color: #0AC18E; background: rgba(10, 193, 142, 0.15); }
.journey-line.done { background: #0AC18E; }
.journey-node.current { transform: scale(1.2); animation: node-bounce 1.1s ease-in-out infinite; }
@keyframes node-bounce {
  0%, 100% { transform: scale(1.2) translateY(0); }
  50% { transform: scale(1.2) translateY(-4px); }
}
.journey-label {
  font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(255, 255, 255, 0.35);
  position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 6px; white-space: nowrap;
}
.journey-node.current .journey-label { color: white; font-weight: 700; }

/* 樂透球徽章（開獎時刻，尚未開獎前不揭露真實號碼） */
.lotto-ball { border-radius: 9999px; display: flex; align-items: center; justify-content: center; font-weight: 900; border: 2px solid rgba(255, 255, 255, 0.25); }
.lotto-ball-bounce { animation: lotto-bounce 1.3s ease-in-out infinite; }
@keyframes lotto-bounce {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-5px) rotate(8deg); }
}

/* 彩帶慶祝 */
:deep(.confetti-piece) {
  position: absolute; top: -10px; width: 8px; height: 8px; opacity: 0.9;
  animation: confetti-fall linear forwards;
}
@keyframes confetti-fall {
  to { transform: translateY(240px) rotate(540deg); opacity: 0; }
}
</style>

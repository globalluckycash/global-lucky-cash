<template>
  <div
    class="bg-bg-card border rounded-xl p-4 flex flex-col gap-2 transition"
    :class="[
      isReady ? 'hover:border-current/30' : '',
      tone === 'warning' ? 'border-amber-400/20' : (isWaiting ? 'border-amber-400/40 bg-amber-400/5 animate-glow-pulse-amber' : 'border-white/5'),
    ]"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <h3 class="font-bold text-sm leading-tight">{{ title }}</h3>
        <SdkSourceHint v-if="sdkUrl" :sdk-url="sdkUrl" class="shrink-0" />
      </div>
      <span
        v-if="isReady"
        class="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono border border-white/10 leading-tight"
        :class="readyBadgeClass"
      >
        {{ t('trigger.ready') }}
      </span>
    </div>

    <div v-if="timeLabel || progressTotal" class="flex flex-wrap items-center gap-1.5">
      <div
        v-if="timeLabel"
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/10 font-mono text-[11px] text-gray-300"
        :title="timeKind === 'mtp' ? t('trigger.time_kind_mtp_full') : t('trigger.time_kind_realtime_full')"
      >
        <i :class="timeKind === 'mtp' ? 'fa-solid fa-cubes text-sky-400' : 'fa-solid fa-clock text-gray-400'"></i>
        <span class="font-bold" :class="timeKind === 'mtp' ? 'text-sky-400' : 'text-gray-400'">
          {{ timeKind === 'mtp' ? t('trigger.time_kind_mtp') : t('trigger.time_kind_realtime') }}
        </span>
        <span>{{ timeLabel }}</span>
      </div>
      <div
        v-if="progressTotal"
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bch/5 border border-bch/20 font-mono text-[11px]"
      >
        <div class="w-8 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div class="h-full bg-bch" :style="{ width: `${(progressDone / progressTotal) * 100}%` }"></div>
        </div>
        <span class="font-bold text-bch">{{ progressDone }}/{{ progressTotal }}</span>
      </div>
    </div>

    <p class="text-xs leading-snug flex-grow" :class="isWaiting ? 'text-amber-300/90' : 'text-gray-500'">{{ hint }}</p>

    <button
      class="w-full py-2 rounded-lg font-black text-xs uppercase tracking-wide transition flex items-center justify-center gap-2"
      :class="canExecute ? executeButtonClass : 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/5'"
      :disabled="!canExecute"
      @click="$emit('execute')"
    >
      <template v-if="isBusy">
        <i class="fa-solid fa-gear spinner"></i>
        {{ spinnerLabel }}
      </template>
      <template v-else>
        <i v-if="canExecute" :class="tone === 'warning' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-bolt'"></i>
        {{ canExecute ? t('trigger.execute') : t('trigger.condition_not_met') }}
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SdkSourceHint from '@/components/SdkSourceHint.vue'
import type { TxState } from '@/types'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  title: string
  hint: string
  isReady: boolean
  txState: TxState
  /** 點擊後開新分頁連到這個操作對應的 SDK 交易腳本原始碼（GitHub），不給就不顯示提示 icon */
  sdkUrl?: string
  /** 'warning' 用於例外處理（取消／復原）動作，視覺上與正常開獎流程區隔 */
  tone?: 'default' | 'warning'
  /** 條件尚未達成、但唯一卡住的原因是等待鏈上時間到達（例如售票截止/開獎時間）——
   *  整張卡片醒目提示玩家「即將可執行」，跟其他原因造成的不可執行區隔開來 */
  isWaiting?: boolean
  /** 醒目顯示的時間徽章（已格式化的字串）；搭配 timeKind 標示這是鏈上 MTP 時間還是現實時間 */
  timeLabel?: string
  /** 'mtp' = 鏈上 MTP 時間（可能落後現實時間）；'realtime' = 現實時間 */
  timeKind?: 'mtp' | 'realtime'
  /** 醒目顯示的完成比例徽章（例如已結算分片數、已彙整批次數） */
  progressDone?: number
  progressTotal?: number
}>(), {
  tone: 'default',
  isWaiting: false,
  timeKind: 'realtime',
  progressDone: 0,
})

defineEmits<{ execute: [] }>()

const isBusy = computed(() =>
  ['building', 'awaiting_signature', 'broadcasting', 'verifying'].includes(props.txState.status)
)

const canExecute = computed(() =>
  props.isReady && props.txState.status === 'idle'
)

const readyBadgeClass = computed(() =>
  props.tone === 'warning' ? 'text-amber-400 border-amber-400/30' : 'text-bch border-bch/30'
)

const executeButtonClass = computed(() =>
  props.tone === 'warning'
    ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-black shadow-neon-strong hover:scale-[1.03]'
    : 'bg-gradient-to-r from-bch to-bch-glow text-black shadow-neon-strong animate-glow-pulse hover:scale-[1.03]'
)

const spinnerLabel = computed(() => {
  if (props.txState.status === 'building') return 'building...'
  if (props.txState.status === 'awaiting_signature') return 'awaiting signature...'
  if (props.txState.status === 'verifying') return 'connection lost, verifying...'
  return 'broadcasting...'
})
</script>

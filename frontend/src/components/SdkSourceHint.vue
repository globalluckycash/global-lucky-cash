<template>
  <span class="inline-block">
    <a
      :href="sdkUrl"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="t('trigger.view_sdk_source')"
      class="group relative inline-flex transition"
      :class="iconClass"
    >
      <i class="fa-solid fa-terminal text-[11px]"></i>
      <span
        class="pointer-events-none absolute z-20 scale-95 whitespace-nowrap rounded-md border border-bch/40 bg-bch-dark px-2 py-1 text-[10px] font-semibold text-bch-glow opacity-0 shadow-neon transition duration-75 group-hover:scale-100 group-hover:opacity-100"
        :class="{
          'left-full top-1/2 ml-2 -translate-y-1/2': side === 'right',
          'right-full top-1/2 mr-2 -translate-y-1/2': side === 'left',
          'bottom-full right-0 mb-2': side === 'top',
        }"
      >
        {{ t('trigger.view_sdk_source') }}
      </span>
    </a>
  </span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  /** 對應的 SDK 交易腳本原始碼連結（GitHub） */
  sdkUrl: string
  /** icon 顏色，依放置的背景調整——預設給深色卡片用，淺色/彩色底請自行覆寫 */
  iconClass?: string
  /** 提示框從 icon 的哪一側展開——靠右側邊緣用 'left'，icon 旁邊沒有橫向空間（例如按鈕本身文字很長）時用 'top' */
  side?: 'left' | 'right' | 'top'
}>(), {
  iconClass: 'text-gray-500 hover:text-bch',
  side: 'right',
})

const { t } = useI18n()
</script>

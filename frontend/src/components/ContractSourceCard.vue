<template>
  <div class="bg-bg-card border border-white/5 rounded-xl p-5">
    <div class="flex items-start justify-between gap-4 flex-wrap mb-3">
      <div>
        <h3 class="font-bold text-sm">{{ name }}</h3>
        <div v-if="functions && functions.length" class="flex flex-wrap gap-1.5 mt-2">
          <code
            v-for="fn in functions"
            :key="fn"
            class="text-[11px] font-mono text-bch/90 bg-bch/10 border border-bch/20 rounded px-1.5 py-0.5"
          >{{ fn }}</code>
        </div>
      </div>
      <a
        :href="sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="shrink-0 text-xs font-semibold text-bch hover:text-bch-glow transition px-3 py-1.5 rounded-lg border border-bch/20 hover:border-bch/40"
      >
        {{ t('verify.contract_view_source') }}
      </a>
    </div>

    <div class="space-y-1.5 text-xs font-mono">
      <div v-if="address" class="flex items-center gap-2 flex-wrap">
        <span class="text-gray-500 shrink-0">{{ t('verify.contract_address_label') }}:</span>
        <a
          :href="explorerAddressUrl(address)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-gray-300 hover:text-bch transition break-all underline underline-offset-2"
        >
          {{ address }}
        </a>
      </div>
      <p v-else class="text-gray-600 text-[11px] font-sans">{{ t('verify.contract_no_fixed_address') }}</p>
      <div v-if="balanceBch" class="flex items-center gap-2 flex-wrap">
        <span class="text-gray-500 shrink-0">{{ t('verify.contract_balance_label') }}:</span>
        <span class="text-bch">{{ balanceBch }} BCH</span>
      </div>
    </div>

    <a
      v-if="claimSdkUrl"
      :href="claimSdkUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1.5 text-xs font-semibold text-bch/90 hover:text-bch transition mt-3"
    >
      <i class="fa-solid fa-terminal text-[10px]"></i>
      {{ claimSdkLabel }}
    </a>

    <p v-if="note" class="text-gray-500 text-xs leading-relaxed mt-3">{{ note }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { explorerAddressUrl } from '@/lib/explorer'

defineProps<{
  name: string
  functions?: string[]
  address?: string
  balanceBch?: string
  note?: string
  sourceUrl: string
  /** 玩家實際請領這個獎池獎金時呼叫的 SDK 交易腳本連結（GitHub） */
  claimSdkUrl?: string
  claimSdkLabel?: string
}>()

const { t } = useI18n()
</script>

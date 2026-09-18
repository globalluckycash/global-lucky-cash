<template>
  <a
    :href="txidUrl"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="t('donate.view_txid')"
    class="group relative bg-bg-card border border-bch/10 rounded-2xl p-4 flex gap-3 items-start hover:border-bch/30 transition"
  >
    <div class="w-9 h-9 rounded-full bg-bch/15 border border-bch/40 flex items-center justify-center shrink-0">
      <i class="fa-solid fa-heart text-bch text-sm"></i>
    </div>
    <div class="flex-grow min-w-0">
      <div class="flex items-center justify-between gap-2 flex-nowrap">
        <span class="text-base font-black text-bch truncate min-w-0">{{ amountBch }} BCH</span>
        <span class="relative shrink-0">
          <span class="text-[11px] font-mono text-gray-500 px-2 py-0.5 rounded-full border border-white/10 whitespace-nowrap">
            {{ t('donate.round_badge', { round: entry.state.round }) }}
          </span>
          <span
            class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 scale-95 whitespace-nowrap rounded-md border border-bch/40 bg-bch-dark px-2 py-1 text-[10px] font-semibold text-bch-glow opacity-0 shadow-neon transition duration-75 group-hover:scale-100 group-hover:opacity-100"
          >
            {{ t('donate.view_txid') }}
          </span>
        </span>
      </div>
      <p v-if="loadingMessage" class="text-sm text-gray-500 mt-1.5 animate-pulse">{{ t('donate.message_loading') }}</p>
      <p v-else-if="message" class="text-sm text-gray-200 mt-1.5 pl-3 border-l-2 border-bch/40 italic break-words">{{ message }}</p>
      <p v-else class="text-sm text-gray-500 mt-1.5 italic">{{ t('donate.no_message') }}</p>
    </div>
  </a>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DonationMessageEntry } from '@/lib/electrum'
import { bchExplorerCashTxUrl } from '@/lib/explorer'

const { t } = useI18n()

const props = defineProps<{
  entry: DonationMessageEntry
  message: string | null
  loadingMessage: boolean
}>()

const amountBch = computed(() => (Number(props.entry.state.donationTotal) / 1e8).toFixed(8))
const txidUrl = computed(() => bchExplorerCashTxUrl(props.entry.utxo.txid))
</script>

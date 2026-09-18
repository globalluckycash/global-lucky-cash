<template>
  <a
    v-if="txid"
    :href="explorerTxUrl(txid)"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1.5 text-xs font-mono text-bch hover:text-bch-glow transition break-all underline underline-offset-2"
  >
    {{ txid }}
    <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
  </a>
  <span v-else class="text-xs text-gray-600">{{ t('verify.draw_txid_missing') }}</span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { explorerTxUrl } from '@/lib/explorer'

defineProps<{ txid: string | null }>()

const { t } = useI18n()
</script>

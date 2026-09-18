<template>
  <div class="inline-flex items-center gap-2 text-xs text-gray-500">
    <span>{{ t('common.explorer_source_label') }}</span>
    <div class="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
      <button
        v-for="(provider, idx) in providers"
        :key="provider.name"
        type="button"
        class="px-2.5 py-1 rounded-md text-xs font-bold transition"
        :class="selectedExplorerIndex === idx
          ? 'bg-bch/20 text-bch border border-bch/30'
          : 'border border-transparent text-gray-500 hover:text-gray-300'"
        @click="selectedExplorerIndex = idx"
      >
        {{ provider.name }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { explorerProviders, selectedExplorerIndex } from '@/lib/explorer'

const { t } = useI18n()
const providers = explorerProviders()
</script>

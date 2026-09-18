<template>
  <div class="bg-bg-card border border-red-500/20 rounded-2xl p-6">
    <div class="flex items-center gap-2 font-bold text-lg mb-3">
      {{ t('results.round', { round }) }}
      <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400">
        {{ t('results.round_canceled') }}
      </span>
    </div>

    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <p class="text-sm text-gray-400">{{ t('results.round_canceled_hint') }}</p>
      <RouterLink
        to="/my-tickets"
        class="shrink-0 px-4 py-1.5 rounded-xl text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition text-center"
      >
        {{ t('results.round_canceled_cta') }}
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()

defineProps<{
  round: number
}>()
</script>

<template>
  <div class="bg-bg-card border border-white/5 rounded-2xl p-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
      <div class="flex items-center gap-3 flex-wrap">
        <span class="font-bold text-lg">{{ t('results.round', { round: wn.drawRound }) }}</span>
        <RouterLink
          :to="`/verify?round=${wn.drawRound}`"
          class="text-[11px] font-semibold text-bch/70 hover:text-bch underline underline-offset-2 transition"
        >
          <i class="fa-solid fa-shield-halved mr-1"></i>{{ t('results.verify_round') }}
        </RouterLink>
      </div>
      <div class="text-xs text-gray-500 font-mono">
        {{ t('results.tickets_sold') }}: {{ wn.cumulativeSales.toString() }}
      </div>
    </div>

    <!-- Numbers -->
    <div class="flex items-center gap-3 flex-wrap mb-4">
      <NumberBall v-for="n in [wn.n1, wn.n2, wn.n3]" :key="n" :number="n" color="green" />
      <span class="mx-1 text-gray-600">+</span>
      <NumberBall :number="wn.s" color="purple" />

      <button
        v-if="canProcessExpired"
        type="button"
        :disabled="processing"
        @click="$emit('processExpired')"
        class="ml-2 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition"
      >
        <i class="fa-solid fa-rotate" :class="processing ? 'animate-spin' : ''"></i>
        {{ t('results.process_expired') }}
      </button>
    </div>

    <!-- Jackpot status -->
    <div v-if="jackpotWon" class="mb-3 rounded-xl bg-gradient-to-b from-yellow-400/15 to-transparent border border-yellow-400/30 px-5 py-4 text-center">
      <div class="text-yellow-300/70 text-xs uppercase tracking-widest font-semibold mb-1">
        {{ t('results.jackpot_amount_label') }}
      </div>
      <div class="text-3xl md:text-4xl font-black text-yellow-400 flex items-center justify-center gap-2">
        <i class="fa-solid fa-trophy text-2xl"></i>
        {{ jackpotAmountBch.toFixed(4) }} <span class="text-lg">BCH</span>
      </div>
      <div v-if="wn.saleRate" class="text-white/30 font-mono text-xs mt-1">
        ≈ ${{ jackpotAmountUsd }} USD
      </div>
    </div>
    <div v-if="jackpotWon" class="flex items-center gap-2 text-yellow-400/90 text-sm font-bold">
      <span v-if="winnerCount != null">{{ t('results.winner_count', { count: winnerCount }) }}</span>
      <span v-if="claimedCount != null">{{ t('results.claimed_count', { claimed: claimedCount, total: winnerCount }) }}</span>
    </div>
    <div v-if="!jackpotWon" class="flex items-center gap-2 text-gray-500 text-sm">
      <i class="fa-solid fa-arrow-up"></i>
      {{ t('results.jackpot_accumulated') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { WNNftState } from '@/types'
import NumberBall from './NumberBall.vue'

const { t } = useI18n()

const props = defineProps<{
  wn: WNNftState
  jackpotWon: boolean
  jackpotAmountSats?: bigint
  winnerCount?: number
  claimedCount?: number
  canProcessExpired?: boolean
  processing?: boolean
}>()

defineEmits<{ processExpired: [] }>()

const jackpotAmountBch = computed(() => Number(props.jackpotAmountSats ?? 0n) / 1e8)

// saleRate 已放大 100 倍（ATTESTATION_SCALING），還原後才是實際 USD/BCH 匯率
const jackpotAmountUsd = computed(() => {
  if (!props.wn.saleRate) return '0.00'
  const usd = jackpotAmountBch.value * (props.wn.saleRate / 100)
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
})
</script>

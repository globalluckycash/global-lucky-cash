<template>
  <div class="bg-bg-card border border-white/5 rounded-2xl p-6">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-4 text-left"
      :class="isOpen ? 'mb-2 pb-3 border-b border-white/5' : ''"
      @click="isOpen = !isOpen"
    >
      <div class="flex items-center gap-2 font-bold">
        <i class="fa-solid fa-chevron-right text-xs text-gray-500 transition-transform" :class="{ 'rotate-90': isOpen }"></i>
        {{ t('my_tickets.round', { round }) }}
        <span v-if="isCanceled" class="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400">
          {{ t('my_tickets.round_canceled') }}
        </span>
      </div>
      <div class="text-xs text-gray-500 font-mono text-right">
        <div>{{ t('my_tickets.ticket_count', { n: tickets.length }) }}</div>
        <div v-if="ticketPriceBch">{{ t('my_tickets.ticket_price', { price: ticketPriceBch }) }}</div>
      </div>
    </button>

    <div v-if="isOpen" class="divide-y divide-white/5">
      <TicketRow
        v-for="ticket in tickets"
        :key="`${ticket.utxo.txid}-${ticket.utxo.vout}`"
        :ticket="ticket"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ParsedTicket } from '@/types'
import TicketRow from './TicketRow.vue'
import { useTicketStore } from '@/stores/ticket'
import { ticketPriceSats } from '@/lib/pricing'

const { t } = useI18n()
const ticketStore = useTicketStore()

const props = defineProps<{
  round: number
  tickets: ParsedTicket[]
  defaultOpen?: boolean
}>()

const isOpen = ref(props.defaultOpen ?? false)
const isCanceled = computed(() => ticketStore.canceledRounds.has(props.round))

// 同一輪所有票的 purchaseRate 皆相同（見 RoundShardAuth.cash sellTicket()，同一輪內
// 每次購票都讀同一份 RSC.stagedRate 快照寫入新 TicketNFT），取第一張換算即可代表整輪
const ticketPriceBch = computed(() => {
  const rate = props.tickets[0]?.purchaseRate
  if (!rate) return null
  return (Number(ticketPriceSats(rate)) / 1e8).toFixed(6)
})
</script>

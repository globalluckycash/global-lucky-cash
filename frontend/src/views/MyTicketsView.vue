<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-3">{{ t('my_tickets.title') }}</h1>
      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-6">
        <i class="fa-solid fa-ticket text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('my_tickets.subtitle') }}</p>
      </div>

      <!-- Not connected (DEV: bypassed) -->
      <!-- <div v-if="!walletStore.isConnected" class="text-center py-20"> ... </div> -->

      <!-- Connected -->
      <!-- Always visible, not just on the empty state — a player may be missing only some -->
      <!-- tickets (bought/received on another address) rather than seeing none at all. -->
      <div class="rounded-2xl border border-white/5 bg-bg-card p-4 mb-6 text-sm leading-relaxed space-y-2">
        <p class="font-bold text-bch flex items-center gap-1.5">
          <i class="fa-solid fa-circle-info"></i>{{ t('my_tickets.notice_title') }}
        </p>
        <p class="text-gray-300">{{ t('my_tickets.notice_reason') }}</p>
        <p class="text-gray-300">{{ t('my_tickets.notice_suggestion_1') }}</p>
        <p class="text-gray-300">{{ t('my_tickets.notice_suggestion_2') }}</p>
        <p class="text-yellow-400/90 flex items-start gap-2 pt-2 mt-1 border-t border-white/10">
          <i class="fa-solid fa-triangle-exclamation mt-0.5 shrink-0"></i>
          <span>{{ t('my_tickets.notice_address_care') }}</span>
        </p>
      </div>

      <!-- Filter tabs -->
      <div class="flex gap-2 mb-6 flex-wrap">
        <button
          v-for="f in filters"
          :key="f.value"
          @click="activeFilter = f.value"
          :class="[
            'px-4 py-1.5 rounded-full text-sm font-bold border transition',
            activeFilter === f.value
              ? 'bg-bch/20 border-bch/50 text-bch'
              : 'border-white/10 text-gray-400 hover:bg-white/5',
          ]"
        >
          {{ f.label }}
        </button>
      </div>

      <!-- Loading -->
      <div v-if="ticketStore.loading" class="text-center py-12 text-gray-500">
        <i class="fa-solid fa-gear spinner text-2xl mr-2"></i>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="text-center text-red-400 text-sm py-12">
        <i class="fa-solid fa-triangle-exclamation mr-1"></i> {{ error }}
      </div>

      <!-- No tickets at all under the connected address -->
      <div v-else-if="ticketStore.tickets.length === 0" class="text-center py-20">
        <i class="fa-solid fa-ticket text-5xl text-gray-600 mb-6 block"></i>
        <p class="text-gray-400">{{ t('my_tickets.no_tickets') }}</p>
      </div>

      <!-- Tickets exist, but none match the active filter -->
      <div v-else-if="filteredTickets.length === 0" class="text-center py-20">
        <i class="fa-solid fa-filter-circle-xmark text-5xl text-gray-600 mb-6 block"></i>
        <p class="text-gray-400">{{ t('my_tickets.no_filtered_tickets') }}</p>
      </div>

      <!-- Ticket list, grouped by round (collapsible; most recent round starts open) -->
      <div v-else class="space-y-4">
        <RoundTicketGroup
          v-for="(group, index) in groupedTickets"
          :key="group.round"
          :round="group.round"
          :tickets="group.tickets"
          :default-open="index === 0"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import RoundTicketGroup from '@/components/RoundTicketGroup.vue'
import { useWalletStore } from '@/stores/wallet'
import { useTicketStore } from '@/stores/ticket'
import type { ParsedTicket } from '@/types'

const { t } = useI18n()
const walletStore = useWalletStore()
const ticketStore = useTicketStore()

type FilterValue = 'all' | 'unclaimed' | 'claimed'
const activeFilter = ref<FilterValue>('all')

const filters = computed(() => [
  { value: 'all' as FilterValue,       label: t('my_tickets.filter_all') },
  { value: 'unclaimed' as FilterValue, label: t('my_tickets.filter_unclaimed') },
  { value: 'claimed' as FilterValue,   label: t('my_tickets.filter_claimed') },
])

const filteredTickets = computed((): ParsedTicket[] => {
  switch (activeFilter.value) {
    case 'unclaimed':
      // 未領獎：中獎但尚未領獎，或所屬輪次已被取消、尚未申請退款
      return ticketStore.tickets.filter(t =>
        t.claimStatus === 0 &&
        ((t.prizeLevel && t.prizeLevel !== 'none') || ticketStore.canceledRounds.has(t.round))
      )
    case 'claimed':
      // 已領獎：低nibble非0（已領頭獎或固定獎一~四獎之一）或 bit4(0x10)已退款，皆已處理完畢
      return ticketStore.tickets.filter(t => (t.claimStatus & 0x0f) !== 0 || (t.claimStatus & 0x10) !== 0)
    default:
      return ticketStore.tickets
  }
})

interface RoundGroup {
  round: number
  tickets: ParsedTicket[]
}

// Group tickets from the same round into one card, most recent round first.
const groupedTickets = computed((): RoundGroup[] => {
  const byRound = new Map<number, ParsedTicket[]>()
  for (const ticket of filteredTickets.value) {
    const list = byRound.get(ticket.round)
    if (list) list.push(ticket)
    else byRound.set(ticket.round, [ticket])
  }
  return Array.from(byRound.entries())
    .map(([round, tickets]) => ({ round, tickets }))
    .sort((a, b) => b.round - a.round)
})

const DEV_ADDRESS = 'bchtest:zr6te35y44vxu464xrzqd872840peal4ccp4kxdzk5'

const error = ref<string | null>(null)

async function loadTickets() {
  error.value = null
  try {
    await ticketStore.fetchForAddress(walletStore.address ?? DEV_ADDRESS)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(loadTickets)

watch(() => walletStore.address, (addr) => {
  if (addr) loadTickets()
  else ticketStore.clear()
})
</script>

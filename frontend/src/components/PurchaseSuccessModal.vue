<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 modal-overlay"
        @click.self="$emit('close')"
      >
        <div class="relative bg-bg-card border border-bch/30 rounded-3xl p-8 w-full max-w-md shadow-2xl shadow-neon-strong my-8 text-center overflow-hidden">
          <div class="absolute inset-0 bg-gradient-to-br from-bch/10 via-transparent to-purple-500/10 pointer-events-none"></div>

          <div class="relative">
            <i class="fa-solid fa-circle-check text-4xl text-bch mb-3"></i>
            <h2 class="text-2xl font-black mb-1">{{ t('purchase_success.title') }}</h2>
            <p class="text-gray-400 text-sm mb-2">{{ t('purchase_success.round_notice', { round }) }}</p>
            <p class="text-xs text-gray-500 mb-6 leading-relaxed">{{ t('purchase_success.desc') }}</p>

            <div class="text-xs text-gray-500 mb-2 text-left">
              {{ t('purchase_success.ticket_count', { n: tickets.length }) }}
            </div>
            <div class="space-y-2 bg-black/30 rounded-2xl p-4 mb-4 text-left">
              <div
                v-for="(ticket, idx) in tickets"
                :key="idx"
                class="flex items-center gap-2 flex-wrap"
              >
                <span class="text-xs text-gray-500 font-mono w-5 shrink-0">#{{ idx + 1 }}</span>
                <NumberBall v-for="n in [ticket.n1, ticket.n2, ticket.n3]" :key="n" :number="n" color="green" />
                <span class="text-gray-600 mx-1">+</span>
                <NumberBall :number="ticket.s" color="purple" />
              </div>
            </div>

            <div class="flex items-center justify-between px-4 py-3 bg-black/30 rounded-xl mb-4 text-sm">
              <span class="text-gray-500">{{ t('purchase_success.total_paid') }}</span>
              <span class="font-bold text-bch">{{ totalPriceBch }} BCH</span>
            </div>

            <div v-if="txid" class="bg-black/30 rounded-xl p-3 mb-6">
              <div class="text-xs text-gray-500 mb-1">TXID</div>
              <div class="font-mono text-xs text-bch break-all">{{ txid }}</div>
            </div>

            <div class="flex gap-3">
              <button
                class="flex-1 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
                @click="$emit('close')"
              >
                {{ t('purchase_success.close') }}
              </button>
              <a
                v-if="txid"
                :href="explorerTxUrl(txid)"
                target="_blank"
                rel="noopener"
                class="flex-1 py-3 rounded-2xl bg-bch/20 text-bch border border-bch/30 font-bold hover:bg-bch/30 transition flex items-center justify-center"
              >
                {{ t('purchase_success.view_tx') }}
              </a>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import NumberBall from './NumberBall.vue'
import type { LotteryNumber } from '@/composables/useBuyTicket'
import { explorerTxUrl } from '@/lib/explorer'

const { t } = useI18n()

defineProps<{
  visible: boolean
  tickets: LotteryNumber[]
  round: number
  totalPriceBch: string
  txid: string | null
}>()

defineEmits<{ close: [] }>()

</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

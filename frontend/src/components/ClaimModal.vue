<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 modal-overlay" @click.self="onBackdrop">
        <div class="relative bg-bg-card border border-white/10 rounded-3xl p-8 w-full max-w-md shadow-2xl my-8">
          <h2 class="text-xl font-black mb-6">{{ t(titleKey) }}</h2>

          <!-- Idle: confirmation screen -->
          <template v-if="txState.status === 'idle'">
            <div v-if="prizeAmountBch" class="bg-black/30 rounded-2xl p-4 mb-4 text-center">
              <p class="text-gray-400 text-xs mb-1">{{ variant === 'refund' ? t('claim_modal.refund_amount') : t('claim_modal.prize_amount') }}</p>
              <p class="text-3xl font-black text-bch">{{ prizeAmountBch }} BCH</p>
            </div>
            <p v-if="variant === 'jackpot'" class="text-xs text-yellow-400 mb-4">{{ t('claim_modal.jackpot_note') }}</p>
            <div class="flex gap-3">
              <button
                class="flex-1 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
                @click="$emit('close')"
              >
                {{ t('claim_modal.close') }}
              </button>
              <button
                class="flex-1 py-3 rounded-2xl bg-bch text-black font-black hover:shadow-neon transition"
                @click="$emit('confirm')"
              >
                {{ variant === 'refund' ? t('claim_modal.confirm_refund') : t('claim_modal.confirm') }}
              </button>
            </div>
          </template>

          <!-- In-progress states -->
          <template v-else-if="['building', 'awaiting_signature', 'broadcasting', 'verifying'].includes(txState.status)">
            <div class="flex flex-col items-center gap-4 py-8">
              <i class="fa-solid fa-gear spinner text-bch text-3xl"></i>
              <p class="text-gray-300 font-semibold">
                <span v-if="txState.status === 'building'">{{ t('claim_modal.building') }}</span>
                <span v-else-if="txState.status === 'awaiting_signature'">{{ t('claim_modal.awaiting') }}</span>
                <span v-else-if="txState.status === 'verifying'">{{ t('claim_modal.verifying') }}</span>
                <span v-else>{{ t('claim_modal.broadcasting') }}</span>
              </p>
            </div>
          </template>

          <!-- Success -->
          <template v-else-if="txState.status === 'success'">
            <div class="text-center py-4 space-y-4">
              <div class="flex items-center justify-center gap-3 text-bch">
                <i class="fa-solid fa-circle-check text-3xl"></i>
                <span class="font-black text-xl">{{ variant === 'refund' ? t('claim_modal.success_refund') : t('claim_modal.success') }}</span>
              </div>
              <div v-if="txState.txid" class="bg-black/30 rounded-xl p-3">
                <div class="text-xs text-gray-500 mb-1">TXID</div>
                <div class="font-mono text-xs text-bch break-all">{{ txState.txid }}</div>
              </div>
              <div class="flex gap-3">
                <button
                  class="flex-1 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
                  @click="$emit('close')"
                >
                  {{ t('claim_modal.close') }}
                </button>
                <a
                  v-if="txState.txid"
                  :href="explorerTxUrl(txState.txid)"
                  target="_blank"
                  rel="noopener"
                  class="flex-1 py-3 rounded-2xl bg-bch/20 text-bch border border-bch/30 font-bold text-center hover:bg-bch/30 transition"
                >
                  {{ t('claim_modal.view_tx') }}
                </a>
              </div>
            </div>
          </template>

          <!-- Error -->
          <template v-else-if="txState.status === 'error'">
            <div class="space-y-4">
              <div class="flex items-center gap-3 text-red-400">
                <i class="fa-solid fa-circle-xmark text-xl"></i>
                <span class="font-bold text-sm">{{ txState.error }}</span>
              </div>
              <div class="flex gap-3">
                <button
                  class="flex-1 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
                  @click="$emit('close')"
                >
                  {{ t('claim_modal.close') }}
                </button>
                <button
                  class="flex-1 py-3 rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30 font-bold hover:bg-red-500/30 transition"
                  @click="$emit('retry')"
                >
                  {{ t('claim_modal.retry') }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TxState } from '@/types'
import { explorerTxUrl } from '@/lib/explorer'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  txState: TxState
  variant?: 'fixed' | 'jackpot' | 'refund'
  prizeAmountBch?: string
}>()

const emit = defineEmits<{
  confirm: []
  close: []
  retry: []
}>()

const titleKey = computed(() => {
  switch (props.variant) {
    case 'jackpot': return 'claim_modal.title_jackpot'
    case 'refund': return 'claim_modal.title_refund'
    default: return 'claim_modal.title_fixed'
  }
})

function onBackdrop() {
  if (props.txState.status === 'idle' || props.txState.status === 'success' || props.txState.status === 'error') {
    emit('close')
  }
}

</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

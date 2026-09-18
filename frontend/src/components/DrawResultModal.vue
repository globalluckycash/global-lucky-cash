<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible && result"
        class="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 modal-overlay"
        @click.self="$emit('close')"
      >
        <div class="relative bg-bg-card border border-bch/30 rounded-3xl p-8 w-full max-w-md shadow-2xl shadow-neon-strong my-8 text-center overflow-hidden">
          <div class="absolute inset-0 bg-gradient-to-br from-bch/10 via-transparent to-purple-500/10 pointer-events-none"></div>

          <div class="relative">
            <i class="fa-solid fa-trophy text-4xl text-yellow-400 mb-3"></i>
            <h2 class="text-2xl font-black mb-1">{{ t('draw_result.title') }}</h2>
            <p class="text-gray-400 text-sm mb-6">{{ t('results.round', { round: result.round }) }}</p>

            <div class="flex items-center justify-center gap-3 flex-wrap mb-6">
              <NumberBall v-for="(n, i) in [result.n1, result.n2, result.n3]" :key="i" :number="n" color="green" />
              <span class="text-gray-600 text-xl">+</span>
              <NumberBall :number="result.s" color="purple" />
            </div>

            <p class="text-xs text-gray-500 mb-6 leading-relaxed">{{ t('draw_result.desc') }}</p>

            <div class="flex gap-3">
              <button
                class="flex-1 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
                @click="$emit('close')"
              >
                {{ t('draw_result.close') }}
              </button>
              <RouterLink
                to="/results"
                class="flex-1 py-3 rounded-2xl bg-bch text-black font-black hover:shadow-neon transition flex items-center justify-center"
                @click="$emit('close')"
              >
                {{ t('draw_result.view_results') }}
              </RouterLink>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import NumberBall from './NumberBall.vue'
import type { DrawResult } from '@/composables/useDraw'

const { t } = useI18n()

defineProps<{
  visible: boolean
  result: DrawResult | null
}>()

defineEmits<{ close: [] }>()
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

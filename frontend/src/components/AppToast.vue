<template>
  <Teleport to="body">
    <div class="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-md flex flex-col items-stretch gap-2.5 pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto px-5 py-4 rounded-2xl shadow-2xl text-base font-bold flex items-center gap-3 border-2 backdrop-blur-sm"
          :class="{
            'bg-bg-card/95 border-white/20 text-white': toast.type === 'info',
            'bg-emerald-950/95 border-bch/60 text-bch': toast.type === 'success',
            'bg-amber-950/95 border-amber-400/60 text-amber-300': toast.type === 'warning',
            'bg-red-950/95 border-red-500/60 text-red-300': toast.type === 'error',
          }"
        >
          <i v-if="toast.type === 'success'" class="fa-solid fa-circle-check text-xl shrink-0"></i>
          <i v-else-if="toast.type === 'warning'" class="fa-solid fa-triangle-exclamation text-xl shrink-0"></i>
          <i v-else-if="toast.type === 'error'" class="fa-solid fa-circle-xmark text-xl shrink-0"></i>
          <i v-else class="fa-solid fa-circle-info text-xl shrink-0"></i>
          <span class="leading-snug">{{ toast.message }}</span>
          <button class="ml-auto opacity-60 hover:opacity-100 transition shrink-0" @click="removeToast(toast.id)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, removeToast } = useToast()
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-16px) scale(0.97);
}
</style>

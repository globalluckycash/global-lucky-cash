<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 modal-overlay"
        @click.self="$emit('cancel')"
      >
        <div class="relative bg-bg-card border border-white/10 rounded-3xl p-8 w-full max-w-md shadow-2xl my-8">
          <h2 class="text-xl font-black mb-3">{{ title }}</h2>
          <p class="text-sm text-gray-400 leading-relaxed mb-6">{{ message }}</p>
          <div class="flex gap-3">
            <button
              class="flex-1 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
              @click="$emit('cancel')"
            >
              {{ cancelText }}
            </button>
            <button
              class="flex-1 py-3 rounded-2xl bg-bch text-black font-black hover:shadow-neon transition"
              @click="$emit('confirm')"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
}>()

defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

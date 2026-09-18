<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 modal-overlay">
        <div class="relative bg-bg-card border border-white/10 rounded-3xl p-8 w-full max-w-lg shadow-2xl my-8">
          <div ref="langMenuRef" class="absolute top-6 right-6 shrink-0">
            <button
              class="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs font-mono text-gray-300 transition shrink-0"
              @click="langMenuOpen = !langMenuOpen"
            >
              <i class="fa-solid fa-globe"></i>
              <span>{{ localeOptions.find(o => o.code === locale)?.shortLabel }}</span>
            </button>
            <div
              v-if="langMenuOpen"
              class="absolute right-0 mt-2 w-36 rounded-lg border border-white/10 bg-bg-card shadow-xl overflow-hidden z-50"
            >
              <button
                v-for="opt in localeOptions"
                :key="opt.code"
                class="w-full text-left px-3 py-2 text-xs font-mono hover:bg-white/5 transition"
                :class="locale === opt.code ? 'text-bch' : 'text-gray-300'"
                @click="selectLocale(opt.code)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="flex items-center gap-3 mb-4 pr-16">
            <img src="/logo.png" alt="Global Lucky Cash" class="w-10 h-10 rounded-full border border-bch/50 shadow-neon shrink-0 object-cover" />
            <h2 class="text-xl font-black">{{ t('welcome.title') }}</h2>
          </div>

          <p class="text-sm text-gray-400 leading-relaxed mb-6">{{ t('welcome.intro') }}</p>

          <div class="space-y-4 mb-8">
            <div class="flex items-start gap-3">
              <i class="fa-solid fa-bitcoin-sign text-bch text-lg mt-0.5 shrink-0"></i>
              <div>
                <div class="text-sm font-bold text-white">{{ t('welcome.point1_title') }}</div>
                <div class="text-sm text-gray-400 leading-relaxed">{{ t('welcome.point1_body') }}</div>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <i class="fa-solid fa-file-contract text-bch text-lg mt-0.5 shrink-0"></i>
              <div>
                <div class="text-sm font-bold text-white">{{ t('welcome.point2_title') }}</div>
                <div class="text-sm text-gray-400 leading-relaxed">{{ t('welcome.point2_body') }}</div>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <i class="fa-solid fa-earth-asia text-bch text-lg mt-0.5 shrink-0"></i>
              <div>
                <div class="text-sm font-bold text-white">{{ t('welcome.point3_title') }}</div>
                <div class="text-sm text-gray-400 leading-relaxed">{{ t('welcome.point3_body') }}</div>
              </div>
            </div>
          </div>

          <button
            class="w-full py-3 rounded-2xl bg-bch text-black font-black hover:shadow-neon transition"
            @click="$emit('close')"
          >
            {{ t('welcome.cta') }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleSwitch } from '@/composables/useLocaleSwitch'

const { t } = useI18n()
const { locale, localeOptions, setLocale } = useLocaleSwitch()

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const langMenuOpen = ref(false)
const langMenuRef = ref<HTMLElement | null>(null)

function selectLocale(code: string) {
  setLocale(code)
  langMenuOpen.value = false
}

function handleClickOutside(event: MouseEvent) {
  if (langMenuRef.value && !langMenuRef.value.contains(event.target as Node)) {
    langMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

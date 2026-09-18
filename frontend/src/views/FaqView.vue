<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-3">{{ t('faq.title') }}</h1>
      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-10">
        <i class="fa-solid fa-circle-question text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('faq.subtitle') }}</p>
      </div>

      <div class="space-y-4 mb-10">
        <div
          v-for="(item, i) in items"
          :key="i"
          class="bg-bg-card border border-white/5 rounded-xl overflow-hidden"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between gap-4 text-left p-5"
            @click="toggle(i)"
          >
            <h2 class="font-bold text-sm sm:text-base">{{ rt(item.question) }}</h2>
            <i
              class="fa-solid fa-chevron-down text-xs text-gray-500 transition-transform shrink-0"
              :class="{ 'rotate-180': openSet.has(i) }"
            ></i>
          </button>
          <div v-if="openSet.has(i)" class="px-5 pb-5 border-t border-white/5">
            <p class="text-gray-400 text-sm leading-relaxed whitespace-pre-line pt-4">{{ rt(item.answer) }}</p>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div class="text-center">
        <RouterLink
          to="/"
          class="inline-flex items-center gap-2 bg-gradient-to-r from-bch to-bch-glow text-black px-6 py-3 rounded-xl font-black text-sm shadow-neon-strong hover:scale-[1.03] transition"
        >
          <i class="fa-solid fa-ticket"></i>
          {{ t('faq.cta') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

interface FaqItem {
  question: string
  answer: string
}

const { t, tm, rt } = useI18n()

const items = computed(() => tm('faq.items') as FaqItem[])

const openSet = reactive(new Set<number>([0]))
function toggle(i: number) {
  if (openSet.has(i)) openSet.delete(i)
  else openSet.add(i)
}
</script>

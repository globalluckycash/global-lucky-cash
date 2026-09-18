<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-2">{{ t('terms.title') }}</h1>
      <p class="text-xs text-gray-500 font-mono mb-8">{{ t('terms.updated') }}</p>

      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-10">
        <i class="fa-solid fa-scale-balanced text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('terms.intro') }}</p>
      </div>

      <div class="space-y-8">
        <section v-for="(section, i) in sections" :key="i">
          <h2 class="text-lg font-bold text-bch mb-2">{{ rt(section.heading) }}</h2>
          <p class="text-gray-400 leading-relaxed whitespace-pre-line">{{ rt(section.body) }}</p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface TermsSection {
  heading: string
  body: string
}

const { t, tm, rt } = useI18n()

const sections = computed(() => tm('terms.sections') as TermsSection[])
</script>

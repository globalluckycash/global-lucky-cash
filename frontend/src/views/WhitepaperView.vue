<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <div class="whitepaper-content" v-html="renderedHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import zhContent from '@docs/whitepaper.md?raw'
import enContent from '@docs/whitepaper_en.md?raw'

const { locale } = useI18n()

const rawMarkdown = computed(() => (locale.value === 'zh-TW' ? zhContent : enContent))
const renderedHtml = computed(() => marked.parse(rawMarkdown.value, { async: false }))
</script>

<style scoped>
.whitepaper-content :deep(h1) {
  @apply text-3xl font-black mb-2 text-white;
}
.whitepaper-content :deep(h2) {
  @apply text-xl font-bold text-bch mt-10 mb-3;
}
.whitepaper-content :deep(h3) {
  @apply text-base font-bold text-white mt-6 mb-2;
}
.whitepaper-content :deep(p) {
  @apply text-gray-400 leading-relaxed mb-4;
}
.whitepaper-content :deep(strong) {
  @apply text-white font-semibold;
}
.whitepaper-content :deep(a) {
  @apply text-bch underline underline-offset-2 hover:text-bch-glow transition;
}
.whitepaper-content :deep(ul),
.whitepaper-content :deep(ol) {
  @apply text-gray-400 leading-relaxed mb-4 pl-6 space-y-1;
}
.whitepaper-content :deep(ul) {
  @apply list-disc;
}
.whitepaper-content :deep(ol) {
  @apply list-decimal;
}
.whitepaper-content :deep(blockquote) {
  @apply border-l-2 border-bch/50 pl-4 my-6 text-gray-400 leading-relaxed italic;
}
.whitepaper-content :deep(hr) {
  @apply border-white/10 my-10;
}
.whitepaper-content :deep(code) {
  @apply font-mono text-xs bg-black/30 text-bch-glow rounded px-1.5 py-0.5;
}
.whitepaper-content :deep(pre) {
  @apply bg-bg-card border border-white/10 rounded-lg p-4 overflow-x-auto mb-4;
}
.whitepaper-content :deep(pre code) {
  @apply bg-transparent p-0 text-gray-300;
}
.whitepaper-content :deep(img) {
  @apply max-w-full mx-auto rounded-lg my-6;
}
.whitepaper-content :deep(table) {
  @apply block w-full overflow-x-auto border-collapse text-sm mb-6;
}
.whitepaper-content :deep(th),
.whitepaper-content :deep(td) {
  @apply border border-white/10 px-3 py-2 text-left align-top text-gray-400;
}
.whitepaper-content :deep(th) {
  @apply bg-white/5 text-bch font-bold;
}
</style>

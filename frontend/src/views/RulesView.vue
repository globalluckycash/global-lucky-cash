<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-3">{{ t('rules.title') }}</h1>
      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-10">
        <i class="fa-solid fa-book-open text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('rules.subtitle') }}</p>
      </div>

      <!-- What is this game -->
      <section class="mb-8">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('rules.what_heading') }}</h2>
        <p class="text-gray-400 leading-relaxed">{{ t('rules.what_body') }}</p>
      </section>

      <!-- Where the winning number comes from -->
      <section class="mb-8">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('rules.oracle_heading') }}</h2>
        <p class="text-gray-400 leading-relaxed mb-3">{{ t('rules.oracle_intro') }}</p>
        <ul class="space-y-2 mb-3">
          <li v-for="(p, i) in oraclePoints" :key="i" class="text-gray-400 text-sm leading-relaxed">
            <span class="font-bold text-gray-200">{{ p.title }}:</span> {{ p.body }}
          </li>
          <li class="text-gray-400 text-sm leading-relaxed">
            <span class="font-bold text-gray-200">{{ t('rules.oracle_point3_title') }}:</span>
            {{ t('rules.oracle_point3_before') }}<a
              href="https://oracles.cash"
              target="_blank"
              rel="noopener noreferrer"
              class="text-bch hover:underline"
            >{{ t('rules.oracle_point3_link') }}</a>{{ t('rules.oracle_point3_after') }}
          </li>
        </ul>
        <p class="text-gray-400 leading-relaxed">{{ t('rules.oracle_outro') }}</p>
        <p class="text-gray-500 text-xs leading-relaxed mt-2">
          {{ t('rules.oracle_note') }}
          <RouterLink to="/verify" class="text-bch hover:underline">{{ t('rules.oracle_note_link') }}</RouterLink>
        </p>
      </section>

      <!-- Number picking -->
      <section class="mb-8">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('rules.numbers_heading') }}</h2>
        <p class="text-gray-400 leading-relaxed mb-4">{{ t('rules.numbers_intro') }}</p>
        <div class="bg-bch/5 border border-bch/10 rounded-xl p-5">
          <div class="flex items-center gap-2 flex-wrap mb-2">
            <NumberBall :number="5" color="green" />
            <NumberBall :number="12" color="green" />
            <NumberBall :number="27" color="green" />
            <span class="text-gray-600 mx-1">+</span>
            <NumberBall :number="9" color="purple" />
          </div>
          <p class="text-gray-500 text-xs">{{ t('rules.numbers_example_caption') }}</p>
        </div>
      </section>

      <!-- Prize tiers -->
      <section class="mb-8">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('rules.prizes_heading') }}</h2>
        <p class="text-gray-400 leading-relaxed mb-4">{{ t('rules.prizes_intro') }}</p>

        <!-- Jackpot: called out as its own hero card, not just another table row -->
        <div class="rounded-xl bg-gradient-to-b from-yellow-400/15 to-transparent border border-yellow-400/30 px-5 py-4 mb-3">
          <div class="flex items-center gap-2 mb-1">
            <i class="fa-solid fa-trophy text-yellow-400"></i>
            <span class="font-black text-yellow-400">{{ jackpotTier.label }}</span>
            <span class="text-gray-500 text-xs font-mono ml-auto shrink-0">{{ jackpotTier.odds }}</span>
          </div>
          <p class="text-gray-400 text-xs leading-relaxed mb-1.5">{{ jackpotTier.condition }}</p>
          <p class="text-yellow-400 font-bold text-xs leading-relaxed">{{ jackpotTier.reward }}</p>
        </div>

        <div class="bg-bg-card border border-white/5 rounded-xl divide-y divide-white/5 mb-4">
          <div
            v-for="(p, i) in fixedTiers"
            :key="i"
            class="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
          >
            <div class="text-xs leading-relaxed flex-grow font-bold text-gray-200">{{ p.condition }}</div>
            <div class="text-xs font-semibold sm:w-56 shrink-0 text-gray-300">{{ p.reward }}</div>
            <div class="text-gray-500 text-xs font-mono sm:w-32 shrink-0 sm:text-right">{{ p.odds }}</div>
          </div>
        </div>
        <p class="text-gray-400 leading-relaxed">{{ t('rules.prizes_note') }}</p>
      </section>

      <!-- Draw cycle & fund flow -->
      <section class="mb-8">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('rules.cycle_heading') }}</h2>
        <div class="bg-bg-card border border-white/5 rounded-xl p-5">
          <!-- Stat tiles: round length + draw frequency -->
          <div class="grid grid-cols-2 gap-3 mb-6">
            <div class="bg-bch/5 border border-bch/10 rounded-xl p-4 text-center">
              <div class="text-2xl font-black text-bch font-mono">{{ t('rules.cycle_duration_value') }}</div>
              <div class="text-gray-500 text-xs mt-1">{{ t('rules.cycle_duration_label') }}</div>
            </div>
            <div class="bg-bch/5 border border-bch/10 rounded-xl p-4 text-center">
              <div class="text-2xl font-black text-bch font-mono">{{ t('rules.cycle_frequency_value') }}</div>
              <div class="text-gray-500 text-xs mt-1">{{ t('rules.cycle_frequency_label') }}</div>
              <div class="text-gray-600 text-[11px] mt-1 font-mono">{{ t('rules.cycle_frequency_detail') }}</div>
            </div>
          </div>

          <!-- Fund split bar -->
          <h3 class="font-bold text-xs text-gray-300 mb-3">{{ t('rules.cycle_split_heading') }}</h3>
          <div class="h-4 rounded-full overflow-hidden flex mb-3 shadow-neon">
            <div
              v-for="(s, i) in cycleSplit"
              :key="i"
              :style="{ width: s.pct + '%', backgroundColor: splitColors[i] }"
              class="h-full first:rounded-l-full last:rounded-r-full"
            ></div>
          </div>
          <div class="flex flex-wrap gap-x-6 gap-y-2 mb-5">
            <div v-for="(s, i) in cycleSplit" :key="i" class="flex items-center gap-2 text-xs">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: splitColors[i] }"></span>
              <span class="text-gray-300 font-semibold">{{ s.label }}</span>
              <span class="text-gray-500 font-mono">{{ s.pct }}%</span>
            </div>
          </div>

          <p class="text-gray-500 text-xs leading-relaxed">{{ t('rules.cycle_note') }}</p>
        </div>
      </section>

      <!-- How to buy -->
      <section class="mb-10">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('rules.howto_heading') }}</h2>
        <div class="space-y-4 mb-6">
          <div v-for="(s, i) in howtoSteps" :key="i" class="bg-bg-card border border-white/5 rounded-xl p-5">
            <h3 class="font-bold text-sm mb-2">{{ s.title }}</h3>
            <p class="text-gray-400 text-xs leading-relaxed">{{ s.body }}</p>
          </div>
        </div>

        <h3 class="font-bold text-sm mb-4">{{ t('rules.howto_ways_heading') }}</h3>
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="bg-bch/5 border border-bch/10 rounded-xl p-5">
            <h4 class="font-bold text-sm text-bch mb-2">{{ t('rules.howto_wallet_title') }}</h4>
            <p class="text-gray-400 text-xs leading-relaxed">
              {{ t('rules.howto_wallet_before') }}<template v-for="(wl, i) in walletLinks" :key="wl.name"><a
                :href="wl.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-bch hover:underline"
              >{{ wl.name }}</a><span v-if="i < walletLinks.length - 1">{{ t('rules.wallet_link_sep') }}</span></template>{{ t('rules.howto_wallet_after') }}
            </p>
          </div>
          <div v-for="(w, i) in howtoWays" :key="i" class="bg-bch/5 border border-bch/10 rounded-xl p-5">
            <h4 class="font-bold text-sm text-bch mb-2">{{ w.title }}</h4>
            <p class="text-gray-400 text-xs leading-relaxed">{{ w.body }}</p>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <div class="text-center">
        <RouterLink
          to="/"
          class="inline-flex items-center gap-2 bg-gradient-to-r from-bch to-bch-glow text-black px-6 py-3 rounded-xl font-black text-sm shadow-neon-strong hover:scale-[1.03] transition"
        >
          <i class="fa-solid fa-ticket"></i>
          {{ t('rules.cta') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import NumberBall from '@/components/NumberBall.vue'

interface TextPair {
  title: string
  body: string
}
interface PrizeTier {
  label: string
  condition: string
  reward: string
  odds: string
}
interface SplitTier {
  label: string
  pct: number
}
interface WalletLink {
  name: string
  url: string
}

const { t, tm } = useI18n()

const prizes = computed(() => tm('rules.prizes') as PrizeTier[])
const jackpotTier = computed(() => prizes.value[0])
const fixedTiers = computed(() => prizes.value.slice(1))
const oraclePoints = computed(() => tm('rules.oracle_points') as TextPair[])
const howtoSteps = computed(() => tm('rules.howto_steps') as TextPair[])
const howtoWays = computed(() => tm('rules.howto_ways') as TextPair[])
const walletLinks = computed(() => tm('rules.wallet_links') as WalletLink[])
const cycleSplit = computed(() => tm('rules.cycle_split') as SplitTier[])
const splitColors = ['#0AC18E', '#A855F7', '#4B5563']
</script>

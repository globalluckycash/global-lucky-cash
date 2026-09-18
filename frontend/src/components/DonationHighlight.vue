<template>
  <div class="bg-gradient-to-br from-bch/10 via-bg-card to-bg-card border border-bch/20 rounded-3xl p-6 md:p-8 flex flex-col">
    <div class="flex items-center justify-between mb-4 gap-3 shrink-0">
      <h3 class="font-black text-lg flex items-center gap-2">
        <i class="fa-solid fa-heart text-bch"></i>
        {{ t('donate.highlight_title') }}
      </h3>
      <RouterLink to="/donate" class="text-xs font-bold text-bch hover:underline shrink-0 whitespace-nowrap">
        {{ t('donate.highlight_view_all') }}
      </RouterLink>
    </div>

    <div v-if="loading" class="flex-1 min-h-0 flex items-center justify-center text-gray-500 text-sm py-6">
      <i class="fa-solid fa-gear spinner mr-2"></i>
    </div>
    <div v-else-if="entries.length === 0" class="flex-1 min-h-0 flex items-center justify-center text-center py-6">
      <p class="text-gray-400 text-sm">{{ t('donate.highlight_empty') }}</p>
    </div>
    <!-- Fills whatever height the sidebar has left (matches the picker card on
         desktop) and only scrolls once entries overflow that space -->
    <div v-else class="space-y-3 overflow-y-auto pr-1 thin-scroll flex-1 min-h-0">
      <DonationCard
        v-for="entry in entries"
        :key="entry.utxo.txid"
        :entry="entry"
        :message="messages.get(entry.utxo.txid) ?? null"
        :loading-message="loadingKeys.has(entry.utxo.txid)"
      />
    </div>

    <RouterLink
      v-if="!loading"
      to="/donate"
      class="shrink-0 mt-4 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-black text-sm bg-gradient-to-r from-bch to-bch-glow text-black shadow-neon-strong animate-glow-pulse hover:scale-[1.03] transition"
    >
      <i class="fa-solid fa-heart"></i>{{ t('donate.highlight_cta') }}
    </RouterLink>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DonationCard from './DonationCard.vue'
import {
  fetchDonationMessageEntries,
  fetchDonationMessageText,
  fetchJackpotPoolUtxo,
  filterCurrentCycleDonations,
  type DonationMessageEntry,
} from '@/lib/electrum'
import { parseJPCommitment } from '@/lib/nftDecode'

const HIGHLIGHT_LIMIT = 5

const { t } = useI18n()
const loading = ref(true)
const entries = ref<DonationMessageEntry[]>([])
const messages = ref<Map<string, string | null>>(new Map())
const loadingKeys = ref<Set<string>>(new Set())

async function load() {
  loading.value = true
  try {
    const [all, jpUtxo] = await Promise.all([fetchDonationMessageEntries(), fetchJackpotPoolUtxo()])
    const currentPool = { state: parseJPCommitment(jpUtxo.token!.nft!.commitment), utxo: jpUtxo }
    const currentCycle = await filterCurrentCycleDonations(all, currentPool)
    entries.value = currentCycle.slice(0, HIGHLIGHT_LIMIT)

    await Promise.all(entries.value.map(async entry => {
      const key = entry.utxo.txid
      loadingKeys.value.add(key)
      try {
        messages.value.set(key, await fetchDonationMessageText(key))
      } catch {
        messages.value.set(key, null)
      } finally {
        loadingKeys.value.delete(key)
      }
    }))
  } catch {
    entries.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

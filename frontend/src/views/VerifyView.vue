<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-3">{{ t('verify.title') }}</h1>
      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-4">
        <i class="fa-solid fa-shield-halved text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('verify.subtitle') }}</p>
      </div>

      <div class="flex justify-end mb-6">
        <ExplorerSwitcher />
      </div>

      <!-- Key parameters highlight -->
      <section class="mb-10">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Oracle Public Key -->
          <div class="bg-gradient-to-br from-bch/10 to-bch/5 border border-bch/30 rounded-xl p-5">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-bch text-lg">🔑</span>
              <span class="text-bch font-bold text-sm uppercase tracking-wide">{{ t('verify.oracle_pubkey_label') }}</span>
            </div>
            <p class="text-gray-400 text-xs mb-3 leading-relaxed">{{ t('verify.oracle_pubkey_desc') }}</p>
            <div class="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
              <code class="text-green-400 text-xs font-mono break-all flex-1 select-all">{{ oraclePubKey }}</code>
              <button
                class="shrink-0 text-gray-500 hover:text-bch transition-colors"
                :title="t('verify.copy')"
                @click="copyToClipboard(oraclePubKey, 'oracle')"
              >
                <span v-if="copied === 'oracle'" class="text-green-400 text-xs">✓</span>
                <span v-else class="text-xs">📋</span>
              </button>
            </div>
          </div>
          <!-- Token Category ID -->
          <div class="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/30 rounded-xl p-5">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-purple-400 text-lg">🪙</span>
              <span class="text-purple-400 font-bold text-sm uppercase tracking-wide">{{ t('verify.token_category_label') }}</span>
            </div>
            <p class="text-gray-400 text-xs mb-3 leading-relaxed">{{ t('verify.token_category_desc') }}</p>
            <div class="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
              <code class="text-purple-300 text-xs font-mono break-all flex-1 select-all">{{ authNftCategoryId }}</code>
              <button
                class="shrink-0 text-gray-500 hover:text-purple-400 transition-colors"
                :title="t('verify.copy')"
                @click="copyToClipboard(authNftCategoryId, 'category')"
              >
                <span v-if="copied === 'category'" class="text-green-400 text-xs">✓</span>
                <span v-else class="text-xs">📋</span>
              </button>
            </div>
          </div>
          <!-- Admin NFT Category ID -->
          <div class="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/30 rounded-xl p-5">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-amber-400 text-lg">🛡️</span>
              <span class="text-amber-400 font-bold text-sm uppercase tracking-wide">{{ t('verify.admin_nft_category_label') }}</span>
            </div>
            <p class="text-gray-400 text-xs mb-3 leading-relaxed">{{ t('verify.admin_nft_category_desc') }}</p>
            <div class="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
              <code class="text-amber-300 text-xs font-mono break-all flex-1 select-all">{{ adminNftCategoryId }}</code>
              <button
                class="shrink-0 text-gray-500 hover:text-amber-400 transition-colors"
                :title="t('verify.copy')"
                @click="copyToClipboard(adminNftCategoryId, 'admin')"
              >
                <span v-if="copied === 'admin'" class="text-green-400 text-xs">✓</span>
                <span v-else class="text-xs">📋</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Trust model -->
      <section class="mb-10">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('verify.trust_heading') }}</h2>
        <div class="bg-bch/5 border border-bch/10 rounded-xl p-5 mb-3">
          <p class="text-gray-400 text-xs leading-relaxed">{{ t('verify.trust_body') }}</p>
        </div>
        <div class="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300">
          <i class="fa-solid fa-triangle-exclamation mt-0.5 shrink-0"></i>
          <p class="text-xs font-semibold leading-relaxed">{{ t('verify.trust_caveat') }}</p>
        </div>
      </section>
      <!-- Draw recomputation tool -->
      <section class="mb-10">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('verify.draw_heading') }}</h2>
        <p class="text-gray-400 leading-relaxed mb-4">{{ t('verify.draw_intro') }}</p>
        <DrawVerifyTool
          :loading="drawVerify.loading.value"
          :result="drawVerify.result.value"
          :error="drawVerify.error.value"
          :initial-round="initialRound"
          :oracle-pub-key="oraclePubKey"
          @verify="drawVerify.verify"
        />
      </section>
      <!-- Contract address, source & fund verification, grouped by player-facing flow -->
      <section class="mb-10">
        <h2 class="text-lg font-bold text-bch mb-2">{{ t('verify.contracts_heading') }}</h2>
        <p class="text-gray-400 leading-relaxed mb-2">{{ t('verify.contracts_intro') }}</p>
        <p class="text-gray-500 text-xs leading-relaxed mb-6">{{ t('verify.contracts_howto') }}</p>
        <div class="space-y-3">
          <ShardContractCard />
          <ContractSourceCard
            v-for="c in contracts"
            :key="c.key"
            :name="c.name"
            :address="c.address"
            :balance-bch="c.balanceBch"
            :note="c.note"
            :source-url="c.sourceUrl"
            :claim-sdk-url="c.claimSdkUrl"
            :claim-sdk-label="c.claimSdkLabel"
          />
        </div>
        <p class="text-gray-500 text-xs leading-relaxed mt-6 pt-4 border-t border-white/5">
          {{ t('verify.contracts_other_flows_note') }}
          <a
            :href="composablesFolderUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-bch hover:text-bch-glow underline underline-offset-2"
          >{{ t('verify.contracts_other_flows_link') }}</a>
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import ContractSourceCard from '@/components/ContractSourceCard.vue'
import ShardContractCard from '@/components/ShardContractCard.vue'
import DrawVerifyTool from '@/components/DrawVerifyTool.vue'
import ExplorerSwitcher from '@/components/ExplorerSwitcher.vue'
import { getConfig, getContractSourceUrl, getComposableSourceUrl, getComposablesFolderUrl, type ContractKey } from '@/lib/contractConfig'
import { useVerifyDraw } from '@/composables/useVerifyDraw'
import { useContractStore } from '@/stores/contract'
import { fetchPlatformPoolBalance } from '@/lib/electrum'
import { useLiveRefresh } from '@/composables/useLiveRefresh'

interface ContractListItem {
  key: string
  name: string
}

const { t, tm } = useI18n()
const route = useRoute()
const contractStore = useContractStore()
const drawVerify = useVerifyDraw()

useLiveRefresh()

const cfg = getConfig()
const oraclePubKey = cfg.oraclePubKey
const authNftCategoryId = cfg.authNftCategoryId
const adminNftCategoryId = cfg.adminNftCategoryId
const composablesFolderUrl = getComposablesFolderUrl()

const copied = ref<'oracle' | 'category' | 'admin' | null>(null)
async function copyToClipboard(text: string, key: 'oracle' | 'category' | 'admin') {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => { copied.value = null }, 2000)
  } catch {
    // fallback: select the text manually
  }
}

const initialRound = computed(() => {
  const raw = Number(route.query.round)
  return Number.isInteger(raw) && raw > 0 ? raw : null
})

onMounted(() => {
  if (initialRound.value) drawVerify.verify(initialRound.value)
})

function contractInstanceFor(key: string) {
  switch (key) {
    case 'FixedPrizePool': return cfg.fixedPrizePoolContract
    case 'JackpotPool': return cfg.jackpotPoolContract
    case 'PlatformPool': return cfg.platformPoolContract
    default: return undefined
  }
}

function satsToBch(sats: bigint): string {
  return (Number(sats) / 1e8).toFixed(8)
}

const platformPoolBalanceSats = ref(0n)
onMounted(async () => {
  platformPoolBalanceSats.value = await fetchPlatformPoolBalance()
})

// FixedPrizePool/JackpotPool/PlatformPool 額外附上餘額與資金鎖定說明；其餘合約不是資金池，
// 沒有餘額/note。
const contracts = computed(() =>
  (tm('verify.contracts_list') as ContractListItem[]).map(c => {
    const instance = contractInstanceFor(c.key)
    const balanceBch =
      c.key === 'FixedPrizePool' ? satsToBch(contractStore.fppBalance) :
      c.key === 'JackpotPool' ? satsToBch(contractStore.jackpotSats) :
      c.key === 'PlatformPool' ? satsToBch(platformPoolBalanceSats.value) :
      undefined
    const note =
      c.key === 'FixedPrizePool' ? t('verify.funds_note_fixed') :
      c.key === 'JackpotPool' ? t('verify.funds_note_jackpot') :
      c.key === 'PlatformPool' ? t('verify.funds_note_platform') :
      undefined
    const claimSdkUrl =
      c.key === 'FixedPrizePool' ? getComposableSourceUrl('useClaimFixedPrize.ts') :
      c.key === 'JackpotPool' ? getComposableSourceUrl('useClaimJackpot.ts') :
      undefined
    const claimSdkLabel =
      c.key === 'FixedPrizePool' ? t('verify.claim_sdk_fixed') :
      c.key === 'JackpotPool' ? t('verify.claim_sdk_jackpot') :
      undefined
    const sourceUrl = getContractSourceUrl(c.key as ContractKey)
    return {
      key: c.key,
      name: c.name,
      address: instance?.address,
      balanceBch,
      note,
      sourceUrl,
      claimSdkUrl,
      claimSdkLabel,
    }
  })
)
</script>

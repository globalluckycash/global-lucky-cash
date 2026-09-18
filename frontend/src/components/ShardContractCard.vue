<template>
  <div class="bg-bg-card border border-white/5 rounded-xl p-5">
    <div class="flex items-start justify-between gap-4 flex-wrap mb-3">
      <div>
        <h3 class="font-bold text-sm">{{ t('verify.shard_contract_name') }}</h3>
        <p class="text-gray-500 text-xs mt-1 leading-relaxed">{{ t('verify.shard_contract_desc') }}</p>
      </div>
      <a
        :href="sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="shrink-0 text-xs font-semibold text-bch hover:text-bch-glow transition px-3 py-1.5 rounded-lg border border-bch/20 hover:border-bch/40"
      >
        {{ t('verify.contract_view_source') }}
      </a>
    </div>

    <div class="flex items-center gap-2 mb-3">
      <label for="shard-picker" class="text-gray-500 text-xs shrink-0">{{ t('verify.shard_picker_label') }}</label>
      <select
        id="shard-picker"
        v-model.number="selectedShardNumber"
        class="bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-bch/40"
      >
        <option v-for="n in shardCount" :key="n" :value="n">{{ n }}</option>
      </select>
    </div>

    <div class="space-y-1.5 text-xs font-mono">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-gray-500 shrink-0">{{ t('verify.contract_address_label') }}:</span>
        <a
          :href="explorerAddressUrl(address)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-gray-300 hover:text-bch transition break-all underline underline-offset-2"
        >{{ address }}</a>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-gray-500 shrink-0">{{ t('verify.contract_balance_label') }}:</span>
        <span v-if="loadingBalance" class="text-gray-600">{{ t('verify.shard_balance_loading') }}</span>
        <span v-else class="text-bch">{{ balanceBch }} BCH</span>
      </div>
    </div>

    <div class="flex flex-col gap-1 mt-3">
      <a
        :href="walletBuySdkUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-bch/90 hover:text-bch transition"
      >
        <i class="fa-solid fa-terminal text-[10px]"></i>
        {{ t('verify.buy_sdk_wallet') }}
      </a>
      <a
        :href="directBuySdkUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-bch/90 hover:text-bch transition"
      >
        <i class="fa-solid fa-terminal text-[10px]"></i>
        {{ t('verify.buy_sdk_direct') }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getConfig, getRoundShardAuthContract, getContractSourceUrl, getComposableSourceUrl } from '@/lib/contractConfig'
import { fetchRoundShardAuthBalance } from '@/lib/electrum'
import { explorerAddressUrl } from '@/lib/explorer'
import { leHex } from '@/lib/bytes'

const { t } = useI18n()

const shardCount = getConfig().shardCount
const sourceUrl = getContractSourceUrl('RoundShardAuth')
const walletBuySdkUrl = getComposableSourceUrl('useBuyTicket.ts')
const directBuySdkUrl = getComposableSourceUrl('useDirectBuy.ts')

// 玩家看到的是 1-shardCount，合約建構參數 shardId 是 0-based，這裡只在邊界做一次轉換。
const selectedShardNumber = ref(1)

const address = computed(() => getRoundShardAuthContract(leHex(selectedShardNumber.value - 1, 2)).address)

const loadingBalance = ref(false)
const balanceSats = ref(0n)
const balanceBch = computed(() => (Number(balanceSats.value) / 1e8).toFixed(8))

// 用遞增 id 蓋掉「查詢中被使用者切換分片」的舊回應，避免快速切換時餘額顯示成上一個分片的數字。
let requestId = 0
async function refreshBalance() {
  const myRequestId = ++requestId
  const shardId = selectedShardNumber.value - 1
  loadingBalance.value = true
  try {
    const sats = await fetchRoundShardAuthBalance(shardId)
    if (myRequestId === requestId) balanceSats.value = sats
  } finally {
    if (myRequestId === requestId) loadingBalance.value = false
  }
}

watch(selectedShardNumber, refreshBalance)
onMounted(refreshBalance)
</script>

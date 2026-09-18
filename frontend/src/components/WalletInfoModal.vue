<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 modal-overlay"
        @click.self="$emit('close')"
      >
        <div class="relative bg-bg-card border border-white/10 rounded-3xl p-8 w-full max-w-lg shadow-2xl my-8">
          <!-- Close -->
          <button
            class="absolute top-5 right-5 text-gray-500 hover:text-white transition text-xl"
            @click="$emit('close')"
          >
            <i class="fa-solid fa-xmark" />
          </button>

          <h2 class="text-xl font-black mb-6 flex items-center gap-2">
            <i class="fa-solid fa-wallet text-bch/60" />
            {{ t('wallet.info_title') }}
          </h2>

          <div class="space-y-4 mb-6">
            <!-- Balance + NFT/token holdings -->
            <div class="bg-black/30 rounded-2xl p-4">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div class="text-xs text-gray-500 mb-1">{{ t('wallet.balance_label') }}</div>
                  <div class="text-xl font-black text-bch">{{ balanceBch }} BCH</div>
                </div>
                <button
                  class="shrink-0 w-8 h-8 rounded-lg border border-white/10 hover:bg-white/5 text-gray-400 hover:text-white transition flex items-center justify-center"
                  :disabled="loadingHoldings"
                  :title="t('wallet.refresh_holdings')"
                  :aria-label="t('wallet.refresh_holdings')"
                  @click="loadHoldings"
                >
                  <i class="fa-solid fa-rotate-right" :class="{ 'animate-spin': loadingHoldings }" />
                </button>
              </div>

              <div v-if="loadingHoldings" class="text-xs text-gray-500 flex items-center gap-2">
                <span class="w-3 h-3 border-2 border-white/20 border-t-bch rounded-full animate-spin shrink-0"></span>
                {{ t('wallet.loading_holdings') }}
              </div>
              <template v-else>
                <div class="text-xs text-gray-500 mb-2">{{ t('wallet.nft_holdings_label') }}</div>
                <div v-if="tokenGroups.length === 0" class="text-xs text-gray-600">
                  {{ t('wallet.no_tokens') }}
                </div>
                <div v-else class="space-y-2">
                  <div
                    v-for="group in tokenGroups"
                    :key="group.category"
                    class="flex items-center justify-between gap-3 bg-white/5 rounded-xl px-3 py-2"
                  >
                    <div class="font-mono text-[11px] text-white/70 break-all">{{ group.category }}</div>
                    <div class="text-xs font-bold text-bch shrink-0">× {{ group.count }}</div>
                  </div>
                </div>
              </template>
            </div>

            <WalletAddressCard
              :label="t('wallet.cash_address_label')"
              :hint="t('wallet.cash_address_hint')"
              :address="cashAddress"
            />
            <WalletAddressCard
              :label="t('wallet.token_address_label')"
              :hint="t('wallet.token_address_hint')"
              :address="tokenAddress"
            />
          </div>

          <button
            class="w-full py-3 rounded-2xl border border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold transition flex items-center justify-center gap-2"
            @click="$emit('disconnect')"
          >
            <i class="fa-solid fa-right-from-bracket" />
            {{ t('wallet.disconnect') }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWalletStore } from '@/stores/wallet'
import { getAddressUtxos } from '@/lib/electrum'
import { useToast } from '@/composables/useToast'
import WalletAddressCard from '@/components/WalletAddressCard.vue'

const props = defineProps<{
  visible: boolean
}>()

defineEmits<{
  close: []
  disconnect: []
}>()

const { t } = useI18n()
const { showToast } = useToast()
const walletStore = useWalletStore()

const cashAddress = computed(() => walletStore.cashAddress ?? '')
const tokenAddress = computed(() => walletStore.address ?? '')

const loadingHoldings = ref(false)
const balanceSats = ref(0n)
const tokenGroups = ref<{ category: string; count: number }[]>([])

const balanceBch = computed(() => (Number(balanceSats.value) / 1e8).toFixed(8))

// Refetched every time the modal opens rather than cached — holdings can change between opens
// (a ticket purchase, a claim, an incoming transfer) and there's no live-refresh wiring here.
async function loadHoldings() {
  if (!walletStore.address) return
  loadingHoldings.value = true
  try {
    const utxos = await getAddressUtxos(walletStore.address)
    balanceSats.value = utxos.reduce((sum, u) => sum + u.valueSats, 0n)

    const counts = new Map<string, number>()
    for (const u of utxos) {
      if (!u.token) continue
      counts.set(u.token.category, (counts.get(u.token.category) ?? 0) + 1)
    }
    tokenGroups.value = Array.from(counts, ([category, count]) => ({ category, count }))
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error')
  } finally {
    loadingHoldings.value = false
  }
}

watch(() => props.visible, (visible) => {
  if (visible) loadHoldings()
})
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

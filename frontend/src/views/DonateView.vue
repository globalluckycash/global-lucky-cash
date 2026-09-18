<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-2">{{ t('donate.page_title') }}</h1>
      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-8 text-sm">
        <i class="fa-solid fa-heart text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('donate.page_subtitle') }}</p>
      </div>

      <!-- Donation form -->
      <div class="bg-gradient-to-br from-bch/10 via-bg-card to-bg-card border border-bch/20 rounded-3xl p-6 md:p-8 mb-12">
        <div class="space-y-2 mb-5">
          <label class="text-xs text-gray-500 font-semibold uppercase tracking-wider">
            {{ t('donate.form_amount_label') }}
          </label>
          <input
            v-model="amountInput"
            type="number"
            step="0.00000001"
            min="0"
            :placeholder="t('donate.form_amount_placeholder')"
            class="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-white focus:outline-none focus:border-bch/40 transition placeholder:text-gray-600"
          />
          <p v-if="amountInput && !amountValid" class="text-red-400 text-xs">
            <i class="fa-solid fa-circle-xmark mr-1" />{{ t('donate.form_amount_too_small', { min: minDonationBch }) }}
          </p>
        </div>

        <div class="space-y-2 mb-6">
          <label class="text-xs text-gray-500 font-semibold uppercase tracking-wider">
            {{ t('donate.form_message_label') }}
          </label>
          <textarea
            v-model="message"
            rows="3"
            :placeholder="t('donate.form_message_placeholder')"
            class="w-full bg-black/40 border rounded-xl px-4 py-3 text-sm text-white focus:outline-none transition placeholder:text-gray-600 resize-none"
            :class="messageTooLong ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/10 focus:border-bch/40'"
          ></textarea>
          <p class="text-xs" :class="messageTooLong ? 'text-red-400' : 'text-gray-600'">
            <i v-if="messageTooLong" class="fa-solid fa-circle-xmark mr-1" />
            {{ messageTooLong ? t('donate.form_message_too_long') : t('donate.form_message_bytes_remaining', { n: messageBytesRemaining }) }}
          </p>
        </div>

        <div class="relative">
          <button
            @click="onSubmit"
            :disabled="(walletStore.isConnected && (!amountValid || messageTooLong)) || walletStore.status === 'connecting'"
            class="w-full py-4 rounded-2xl font-black text-lg transition flex items-center justify-center gap-2"
            :class="(!walletStore.isConnected || (amountValid && !messageTooLong)) && walletStore.status !== 'connecting'
              ? 'bg-gradient-to-r from-bch to-bch-glow text-black shadow-neon-strong animate-glow-pulse hover:scale-[1.02]'
              : 'bg-bch/20 text-black/40 cursor-not-allowed'"
          >
            <i class="fa-solid fa-heart"></i>
            {{ submitButtonLabel }}
          </button>
          <SdkSourceHint
            :sdk-url="donateSdkUrl"
            class="absolute bottom-2 right-2"
            icon-class="text-black/40 hover:text-black/70"
          />
        </div>
      </div>

      <!-- Donation wall -->
      <h2 class="text-xl font-black mb-4">{{ t('donate.wall_title') }}</h2>

      <div v-if="feed.loading.value && feed.visibleEntries.value.length === 0" class="text-center py-12 text-gray-500">
        <i class="fa-solid fa-gear spinner text-2xl mr-2"></i>{{ t('donate.wall_loading') }}
      </div>
      <div v-else-if="feed.visibleEntries.value.length === 0" class="text-center py-20">
        <i class="fa-solid fa-heart-crack text-5xl text-gray-600 mb-6 block"></i>
        <p class="text-gray-400">{{ t('donate.wall_empty') }}</p>
      </div>
      <div v-else class="space-y-3">
        <DonationCard
          v-for="entry in feed.visibleEntries.value"
          :key="entry.utxo.txid"
          :entry="entry"
          :message="feed.messages.value.get(entry.utxo.txid) ?? null"
          :loading-message="feed.loadingMessages.value.has(entry.utxo.txid)"
        />
      </div>

      <!-- Infinite-scroll sentinel -->
      <div ref="sentinel" class="h-1"></div>
      <div v-if="feed.hasMore.value" class="text-center py-6 text-gray-600 text-sm">
        <i class="fa-solid fa-gear spinner mr-2"></i>
      </div>
    </div>
  </div>

  <DonateModal
    :visible="modalVisible"
    :tx-state="donateState"
    :amount-bch="amountBch"
    :message="message || undefined"
    @confirm="executeDonate"
    @close="closeModal"
    @retry="executeDonate"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWalletStore } from '@/stores/wallet'
import { useContractStore } from '@/stores/contract'
import { usePlayerDonation, MIN_DONATION_SATS } from '@/composables/usePlayerDonation'
import { useDonationFeed } from '@/composables/useDonationFeed'
import { buildMessageLockingBytecode, MAX_MESSAGE_LOCKING_BYTECODE_BYTES } from '@/lib/nftDecode'
import { useToast } from '@/composables/useToast'
import { getComposableSourceUrl } from '@/lib/contractConfig'
import DonateModal from '@/components/DonateModal.vue'
import DonationCard from '@/components/DonationCard.vue'
import SdkSourceHint from '@/components/SdkSourceHint.vue'

const { t } = useI18n()
const walletStore = useWalletStore()
const contractStore = useContractStore()
const { showToast } = useToast()

const amountInput = ref('')
const message = ref('')

const { state: donateState, execute: donateExecute, reset: donateReset } = usePlayerDonation()
const feed = useDonationFeed()

const modalVisible = ref(false)

const minDonationBch = (Number(MIN_DONATION_SATS) / 1e8).toString()
const donateSdkUrl = getComposableSourceUrl('usePlayerDonation.ts')

const messageBytes = computed(() => buildMessageLockingBytecode(message.value || undefined).length)
const messageBytesRemaining = computed(() => MAX_MESSAGE_LOCKING_BYTECODE_BYTES - messageBytes.value)
const messageTooLong = computed(() => messageBytesRemaining.value < 0)

function bchToSats(bchStr: string): bigint | null {
  const n = parseFloat(bchStr)
  if (!Number.isFinite(n) || n <= 0) return null
  return BigInt(Math.round(n * 1e8))
}

const amountSats = computed(() => bchToSats(amountInput.value))
const amountValid = computed(() => amountSats.value !== null && amountSats.value >= MIN_DONATION_SATS)
// donationAmount 是 playerDonation() 的獨立參數，找零精確退回，捐款金額恆等於使用者輸入值
const amountBch = computed(() => (amountSats.value !== null ? (Number(amountSats.value) / 1e8).toFixed(8) : undefined))

const submitButtonLabel = computed(() => {
  if (walletStore.status === 'connecting') return t('wallet.connecting')
  if (!walletStore.isConnected) return t('donate.connect_prompt')
  return t('donate.submit_button')
})

async function onSubmit() {
  if (!walletStore.isConnected) {
    try {
      await walletStore.connectWalletConnect()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
    return
  }
  if (!amountValid.value || messageTooLong.value || amountSats.value === null) return
  modalVisible.value = true
}

async function executeDonate() {
  if (amountSats.value === null) return
  await donateExecute(amountSats.value, message.value || undefined)

  if (donateState.status === 'success') {
    amountInput.value = ''
    message.value = ''
    await contractStore.refresh()
    await feed.init()
  }
}

function closeModal() {
  modalVisible.value = false
  if (donateState.status === 'success' || donateState.status === 'error') donateReset()
}

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(async () => {
  await feed.init()
  observer = new IntersectionObserver(entries => {
    if (entries[0]?.isIntersecting && feed.hasMore.value && !feed.loading.value) {
      feed.loadMore()
    }
  })
  if (sentinel.value) observer.observe(sentinel.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

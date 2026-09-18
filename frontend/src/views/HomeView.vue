<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>

    <div class="max-w-7xl mx-auto px-4 py-12 relative z-10">
      <!-- Hero / Jackpot Widget -->
      <div class="mb-16">
        <JackpotWidget
          v-if="contractStore.rscState"
          :rsc-state="contractStore.rscState"
          :total-jackpot-sats="contractStore.totalJackpotSats"
          :purchase-round="contractStore.purchaseRound"
          :chain-mtp="contractStore.chainMtp"
          :round-period="contractStore.configState?.roundPeriod ?? 0"
          :drawing-round-active="contractStore.drawingRoundActive"
          :drawing-round-number="contractStore.drawingRoundNumber"
          :drawing-round-total-sats="contractStore.drawingRoundTotalSats"
          :drawing-nft-state="contractStore.drawingNftState"
          :verify-pending="!!contractStore.wnAtJackpotPoolState"
          :draw-state="drawState"
          :settled-shard-count="contractStore.settledShardCount"
          :aggregated="contractStore.aggregated"
          @execute-draw="executeDraw"
        />
        <div v-else-if="contractStore.loading" class="text-center text-gray-500 py-20">
          <i class="fa-solid fa-gear spinner mr-2 text-3xl"></i>
        </div>
      </div>

      <!-- Error -->
      <div v-if="contractStore.lastError" class="text-center text-red-400 text-sm mb-8">
        <i class="fa-solid fa-triangle-exclamation mr-1"></i> {{ contractStore.lastError }}
      </div>

      <!-- Ticket price (mobile only): between hero and number picker; the lg+ sidebar copy below covers desktop -->
      <div v-if="contractStore.rscState" class="lg:hidden bg-bg-card border border-white/5 rounded-xl px-4 py-2.5 mb-6 text-sm space-y-1.5">
        <div class="flex items-center justify-between gap-3">
          <span class="flex items-center gap-1.5 text-gray-400">
            <i class="fa-solid fa-ticket text-bch text-xs"></i>
            {{ t('hero.selling_price') }}
            <span class="text-[10px] text-gray-500 font-mono">({{ t('hero.round_label', { round: contractStore.purchaseRound }) }})</span>
          </span>
          <span class="font-bold text-bch">
            {{ ticketPriceBch }} BCH
            <span class="text-gray-500 font-normal text-xs font-mono">(≈ {{ ticketPriceUsd }} USD)</span>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>{{ t('hero.tickets_sold_label') }}: <span class="font-mono">{{ ticketsSoldThisRound }}</span></span>
          <span>{{ t('hero.round_jackpot_added_label') }}: <span class="font-mono">{{ roundJackpotAddedBch }} BCH</span></span>
          <span>{{ t('hero.round_donation_label') }}: <span class="font-mono">{{ roundDonationBch }} BCH</span></span>
        </div>
      </div>

      <div class="grid lg:grid-cols-3 gap-8 lg:items-start">
        <!-- Number picker card -->
        <div ref="pickerCardRef" class="lg:col-span-2 bg-bg-card border border-white/5 rounded-[2rem] p-6 md:p-10 shadow-2xl space-y-10">

          <!-- Normal numbers -->
          <section>
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 class="text-2xl font-black flex items-center gap-3 italic">
                <span class="w-8 h-8 rounded-lg bg-bch flex items-center justify-center text-black text-sm not-italic font-bold">1</span>
                {{ t('picker.normal_title') }}
              </h2>
              <div class="px-4 py-1.5 bg-black/40 rounded-full border border-white/5 font-mono text-xs">
                {{ t('picker.selected') }}: <span class="text-bch font-bold">{{ normalNums.length }}</span> / 3
              </div>
            </div>
            <NumberPicker mode="normal" v-model="normalNums" />
          </section>

          <!-- Special numbers -->
          <section>
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 class="text-2xl font-black flex items-center gap-3 italic">
                <span class="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center text-white text-sm not-italic font-bold">2</span>
                {{ t('picker.special_title') }}
              </h2>
              <div class="px-4 py-1.5 bg-black/40 rounded-full border border-white/5 font-mono text-xs">
                {{ t('picker.selected') }}: <span class="text-purple-400 font-bold">{{ specialNums.length }}</span> / 1
              </div>
            </div>
            <div class="mb-4 bg-purple-500/10 border border-purple-500/20 rounded-2xl px-4 py-3 text-xs text-purple-300 leading-relaxed flex items-start gap-2">
              <i class="fa-solid fa-star mt-0.5 shrink-0"></i>
              <span>{{ t('picker.special_hint') }}</span>
            </div>
            <NumberPicker mode="special" v-model="specialNums" />
          </section>

          <!-- Shared controls: act on both normal and special numbers -->
          <div class="flex gap-3">
            <button type="button"
              class="text-xs text-gray-400 hover:text-white transition flex items-center gap-1.5"
              @click="clearAllNums">
              <i class="fa-solid fa-trash-can"></i>
              {{ t('picker.btn_clear') }}
            </button>
            <button type="button"
              class="text-xs text-bch hover:text-bch-glow transition flex items-center gap-1.5"
              @click="randomPickAll">
              <i class="fa-solid fa-dice"></i>
              {{ t('picker.btn_random') }}
            </button>
          </div>

          <!-- Ticket cart -->
          <section class="pt-4 border-t border-white/5">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 class="text-2xl font-black flex items-center gap-3 italic">
                <span class="w-8 h-8 rounded-lg bg-yellow-400 flex items-center justify-center text-black text-sm not-italic font-bold">3</span>
                {{ t('picker.cart_title') }}
              </h2>
              <div class="flex items-center gap-3">
                <button
                  v-if="ticketCart.length"
                  type="button"
                  class="text-xs text-gray-400 hover:text-red-400 transition flex items-center gap-1.5"
                  @click="clearCart"
                >
                  <i class="fa-solid fa-trash-can"></i>
                  {{ t('picker.btn_clear_cart') }}
                </button>
                <div class="px-4 py-1.5 bg-black/40 rounded-full border border-white/5 font-mono text-xs">
                  {{ t('picker.cart_count') }}: <span class="text-yellow-400 font-bold">{{ ticketCart.length }}</span> / {{ maxTickets }}
                </div>
              </div>
            </div>

            <button
              type="button"
              @click="addToCart"
              :disabled="!canPickNumbers || ticketCart.length >= maxTickets"
              :class="[
                'w-full py-3 rounded-2xl border-2 border-dashed font-bold text-sm transition flex items-center justify-center gap-2 mb-4',
                canPickNumbers && ticketCart.length < maxTickets
                  ? 'border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10'
                  : 'border-white/10 text-gray-600 cursor-not-allowed',
              ]"
            >
              <i class="fa-solid fa-plus"></i>
              {{ t('picker.btn_add_to_cart') }}
            </button>

            <div v-if="ticketCart.length" class="space-y-2">
              <div
                v-for="(entry, idx) in ticketCart"
                :key="idx"
                class="flex items-center justify-between gap-3 bg-black/30 rounded-xl px-4 py-3 border border-white/5"
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs text-gray-500 font-mono w-5 shrink-0">#{{ idx + 1 }}</span>
                  <NumberBall v-for="n in [entry.n1, entry.n2, entry.n3]" :key="n" :number="n" color="green" />
                  <span class="text-gray-600 mx-1">+</span>
                  <NumberBall :number="entry.s" color="purple" />
                </div>
                <button
                  type="button"
                  @click="removeFromCart(idx)"
                  class="text-gray-500 hover:text-red-400 transition shrink-0"
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>
            <div v-else class="text-center text-gray-600 text-sm py-6 border border-dashed border-white/10 rounded-2xl">
              {{ t('picker.cart_empty') }}
            </div>

            <div class="flex items-center justify-end mt-4">
              <span class="text-gray-500 text-sm font-mono">
                Total: {{ totalPriceBch }} BCH
              </span>
            </div>
          </section>

          <!-- Buy actions -->
          <div class="pt-2 border-t border-white/5">
            <!-- Processing state -->
            <div v-if="['building', 'awaiting_signature', 'broadcasting', 'retrying', 'verifying'].includes(buyState.status)"
              class="w-full py-5 rounded-2xl bg-bch/30 font-black text-xl flex items-center justify-center gap-3 text-black/70">
              <i class="fa-solid fa-gear spinner"></i>
              <span v-if="buyState.status === 'awaiting_signature' && buyState.retryAttempt" class="text-sm font-bold text-center">
                {{ t('errors.utxo_race_resign', { attempt: buyState.retryAttempt, max: MAX_UTXO_RACE_RETRIES }) }}
              </span>
              <span v-else-if="buyState.status === 'awaiting_signature'">{{ t('claim_modal.awaiting') }}</span>
              <span v-else-if="buyState.status === 'verifying'">{{ t('claim_modal.verifying') }}</span>
              <span v-else-if="buyState.status === 'retrying'" class="text-sm font-bold text-center">
                {{ t('errors.utxo_race_retrying', { attempt: buyState.retryAttempt, max: MAX_UTXO_RACE_RETRIES }) }}
              </span>
              <span v-else>Processing...</span>
            </div>

            <div v-else class="grid sm:grid-cols-2 gap-2 pt-3">
              <!-- Buy with wallet button -->
              <div class="relative">
                <button
                  @click="onBuyButtonClick"
                  :disabled="(walletStore.isConnected && !canBuy) || walletStore.status === 'connecting'"
                  :class="[
                    'w-full py-2.5 rounded-xl transition flex flex-col items-center justify-center gap-0.5',
                    (canBuy || !walletStore.isConnected) && walletStore.status !== 'connecting'
                      ? 'bg-bch hover:shadow-neon-strong text-black'
                      : 'bg-bch/30 text-black/50 cursor-not-allowed',
                  ]"
                >
                  <span class="font-bold text-sm flex items-center gap-1.5">
                    <i class="fa-solid fa-wallet text-xs"></i>
                    {{ buyButtonLabel }}
                    <span v-if="walletStore.isConnected && ticketCart.length" class="text-[10px] bg-black/10 px-1.5 py-0.5 rounded font-mono">{{ totalPriceBch }} BCH</span>
                  </span>
                  <span class="text-[10px] font-medium opacity-70 flex items-center gap-1">
                    <i class="fa-solid fa-desktop text-[9px]"></i>
                    {{ t('picker.recommend_desktop') }}
                  </span>
                </button>
                <SdkSourceHint
                  :sdk-url="buyTicketsSdkUrl"
                  class="absolute bottom-2 right-2"
                  icon-class="text-black/40 hover:text-black/70"
                  side="top"
                />
              </div>

              <!-- Direct buy (no wallet needed) -->
              <button
                v-if="buyState.status === 'idle'"
                @click="openDirectBuy"
                :disabled="ticketCart.length === 0"
                :class="[
                  'w-full py-2.5 rounded-xl transition flex flex-col items-center justify-center gap-0.5',
                  ticketCart.length > 0
                    ? 'bg-purple-500 hover:shadow-[0_0_15px_rgba(168,85,247,0.6),0_0_30px_rgba(168,85,247,0.3)] text-white'
                    : 'bg-purple-500/10 text-gray-600 cursor-not-allowed',
                ]"
              >
                <span class="font-bold text-sm flex items-center gap-1.5">
                  <i class="fa-solid fa-money-bill-wave text-xs"></i>
                  {{ directBuyButtonLabel }}
                </span>
                <span class="text-[10px] font-medium opacity-70 flex items-center gap-1">
                  <i class="fa-solid fa-mobile-screen-button text-[9px]"></i>
                  {{ t('picker.recommend_mobile') }}
                </span>
              </button>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="flex flex-col gap-6">
          <!-- Ticket price info -->
          <div v-if="contractStore.rscState" ref="ticketPriceCardRef" class="hidden lg:block bg-bg-card border border-white/5 rounded-[2rem] p-8 shrink-0">
            <h3 class="text-lg font-bold mb-4 flex items-center gap-2">
              <i class="fa-solid fa-ticket text-bch"></i>
              {{ t('hero.selling_price') }}
              <span class="text-xs font-normal text-gray-500 font-mono">({{ t('hero.round_label', { round: contractStore.purchaseRound }) }})</span>
            </h3>
            <div class="text-3xl font-black text-bch mb-1">{{ ticketPriceBch }} BCH</div>
            <div class="text-gray-500 text-xs font-mono mb-4">≈ {{ ticketPriceUsd }} USD</div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 border-t border-white/5 pt-3">
              <span>{{ t('hero.tickets_sold_label') }}: <span class="font-mono">{{ ticketsSoldThisRound }}</span></span>
              <span>{{ t('hero.round_jackpot_added_label') }}: <span class="font-mono">{{ roundJackpotAddedBch }} BCH</span></span>
              <span>{{ t('hero.round_donation_label') }}: <span class="font-mono">{{ roundDonationBch }} BCH</span></span>
            </div>
          </div>

          <!-- Donation highlight: height is measured to match the picker card
               (see updateDonationHeight below) so it only scrolls internally
               once entries overflow that space; falls back to natural height
               below the lg breakpoint where the columns stack instead -->
          <DonationHighlight :style="donationHeightPx !== undefined ? { height: donationHeightPx + 'px' } : undefined" />
        </div>
      </div>
    </div>
  </div>

  <!-- Direct Buy Modal -->
  <DirectBuyModal
    :visible="showDirectBuyModal"
    :tickets="ticketCart"
    :recovered="recoveredDeposit"
    @close="showDirectBuyModal = false; recoveredDeposit = null"
  />

  <!-- Buy round confirmation -->
  <ConfirmModal
    :visible="showBuyConfirm"
    :title="t('picker.buy_confirm_title')"
    :message="buyConfirmMessage"
    :confirm-text="t('picker.buy_confirm_confirm')"
    :cancel-text="t('picker.buy_confirm_cancel')"
    @confirm="confirmBuyFromModal"
    @cancel="showBuyConfirm = false"
  />

  <!-- Draw result -->
  <DrawResultModal
    :visible="showDrawResultModal"
    :result="lastDrawResult"
    @close="showDrawResultModal = false"
  />

  <!-- Purchase success (wallet buy flow) -->
  <PurchaseSuccessModal
    v-if="lastPurchase"
    :visible="showPurchaseSuccessModal"
    :tickets="lastPurchase.tickets"
    :round="lastPurchase.round"
    :total-price-bch="lastPurchase.totalPriceBch"
    :txid="lastPurchase.txid"
    @close="showPurchaseSuccessModal = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import JackpotWidget from '@/components/JackpotWidget.vue'
import DonationHighlight from '@/components/DonationHighlight.vue'
import NumberPicker from '@/components/NumberPicker.vue'
import NumberBall from '@/components/NumberBall.vue'
import DirectBuyModal from '@/components/DirectBuyModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import DrawResultModal from '@/components/DrawResultModal.vue'
import PurchaseSuccessModal from '@/components/PurchaseSuccessModal.vue'
import SdkSourceHint from '@/components/SdkSourceHint.vue'
import { useContractStore } from '@/stores/contract'
import { useWalletStore } from '@/stores/wallet'
import { useTicketStore } from '@/stores/ticket'
import { useBuyTicket, type LotteryNumber } from '@/composables/useBuyTicket'
import { useDraw, type DrawResult } from '@/composables/useDraw'
import { useToast } from '@/composables/useToast'
import { ticketPriceSats } from '@/lib/pricing'
import { decodeDepositParam } from '@/lib/depositRecoveryUrl'
import { pkhToTokenAddress, getComposableSourceUrl } from '@/lib/contractConfig'
import { parseLotteryNumber } from '@/lib/nftDecode'
import { MAX_UTXO_RACE_RETRIES } from '@/lib/broadcastRetry'
import { useLiveRefresh } from '@/composables/useLiveRefresh'

const { t } = useI18n()
const contractStore = useContractStore()
const walletStore = useWalletStore()
const ticketStore = useTicketStore()
const { showToast } = useToast()
const route = useRoute()
const router = useRouter()

useLiveRefresh()

const maxTickets = 10 // matches on-chain limit (RoundShardAuth/NumberSales sellTicket)

const buyTicketsSdkUrl = getComposableSourceUrl('useBuyTicket.ts')

const normalNums = ref<number[]>([])
const specialNums = ref<number[]>([])
const ticketCart = ref<LotteryNumber[]>([])

const { state: buyState, execute: buyExecute, reset: buyReset } = useBuyTicket()
const showDirectBuyModal = ref(false)
const showBuyConfirm = ref(false)

// A player who closed the direct-buy tab before finishing lands back here via the same
// URL — see depositRecoveryUrl.ts. Re-populate the cart and reopen the modal straight into
// its deposit_info step (recoveredDeposit prop) instead of losing the in-progress order.
const recoveredDeposit = ref<{ round: number; buyerAddress: string; buyerPkh: Uint8Array } | null>(null)

function tryRecoverDepositFromUrl() {
  const dep = route.query.dep
  if (typeof dep !== 'string') return
  const decoded = decodeDepositParam(dep)
  if (!decoded) return

  ticketCart.value = decoded.lotteryNumbers.map(parseLotteryNumber)
  recoveredDeposit.value = {
    round: decoded.round,
    buyerAddress: pkhToTokenAddress(decoded.buyerPkh),
    buyerPkh: decoded.buyerPkh,
  }
  showDirectBuyModal.value = true
}

// Snapshot of the just-completed wallet purchase, captured before the cart/state reset below
// so the player can see exactly what they signed for instead of landing back on an empty picker.
const showPurchaseSuccessModal = ref(false)
const lastPurchase = ref<{ tickets: LotteryNumber[]; round: number; totalPriceBch: string; txid: string | null } | null>(null)

// Draw trigger, merged into JackpotWidget's "previous round drawing" section
const { state: drawState, execute: drawExecute, reset: drawReset, result: drawResult } = useDraw()
const showDrawResultModal = ref(false)
const lastDrawResult = ref<DrawResult | null>(null)

// Match the donation highlight's height to the picker card's so it only scrolls
// once entries overflow that space, instead of relying on CSS grid stretch —
// which can't cap a sibling's height when that sibling's own content is what's
// driving the row taller in the first place.
const pickerCardRef = ref<HTMLElement | null>(null)
const ticketPriceCardRef = ref<HTMLElement | null>(null)
const donationHeightPx = ref<number | undefined>(undefined)
const SIDEBAR_GAP_PX = 24 // matches gap-6 on the sidebar's flex column

function updateDonationHeight() {
  if (!pickerCardRef.value || !ticketPriceCardRef.value || !window.matchMedia('(min-width: 1024px)').matches) {
    donationHeightPx.value = undefined
    return
  }
  const pickerHeight = pickerCardRef.value.getBoundingClientRect().height
  const ticketPriceHeight = ticketPriceCardRef.value.getBoundingClientRect().height
  donationHeightPx.value = Math.max(0, pickerHeight - ticketPriceHeight - SIDEBAR_GAP_PX)
}

const resizeObserver = new ResizeObserver(updateDonationHeight)

// The ticket-price card only mounts once contractStore.rscState finishes loading
// (async), so re-attach observers whenever these refs actually become available
// rather than just once in onMounted.
watch([pickerCardRef, ticketPriceCardRef], ([picker, ticketPrice]) => {
  resizeObserver.disconnect()
  if (picker) resizeObserver.observe(picker)
  if (ticketPrice) resizeObserver.observe(ticketPrice)
  updateDonationHeight()
}, { immediate: true })

onMounted(() => {
  window.addEventListener('resize', updateDonationHeight)
  tryRecoverDepositFromUrl()
})

onBeforeUnmount(() => {
  resizeObserver.disconnect()
  window.removeEventListener('resize', updateDonationHeight)
})

async function executeDraw() {
  try {
    await drawExecute()
    if (drawState.status === 'success') {
      lastDrawResult.value = drawResult.value
      showDrawResultModal.value = true
      drawReset()
      await contractStore.refresh()
    } else if (drawState.status === 'error') {
      showToast(drawState.error ?? t('errors.unknown_error'), 'error')
      drawReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}

// 玩家實際要付的 sats 數是用「這一輪結算時鎖定」的 purchaseRoundRate 算的（跟下單簽名時
// useBuyTicket.ts / useDirectBuy.ts 用的是同一個 rate 來源），不能用即時的 bchUsdRate，
// 否則顯示的票價會跟簽名金額對不上（BCH 這段期間漲跌，鎖定的 sats 數並不會跟著變）
const ticketPriceLockedSats = computed(() => {
  const rate = contractStore.purchaseRoundRate
  if (!rate) return null
  return ticketPriceSats(rate)
})

const ticketPriceBch = computed(() => {
  const sats = ticketPriceLockedSats.value
  if (sats === null) return '–'
  return (Number(sats) / 1e8).toFixed(6)
})

const totalPriceBch = computed(() => {
  const sats = ticketPriceLockedSats.value
  if (sats === null) return '–'
  return (Number(sats * BigInt(ticketCart.value.length)) / 1e8).toFixed(6)
})

// 已鎖定的 sats 數 × 即時 stagedRate，算出「這批 BCH 現在市值多少美元」——跟上面的
// BCH 數量不同，這裡故意用即時匯率，是要讓玩家看到鎖定金額隨大盤即時波動的美元等值，
// 不是當初鎖定當下的 $1 基準
const ticketPriceUsd = computed(() => {
  const sats = ticketPriceLockedSats.value
  const liveRate = contractStore.bchUsdRate
  if (sats === null || !liveRate) return '–'
  const liveUsdCents = Number(sats) * liveRate / 1e8
  return (liveUsdCents / 100).toFixed(2)
})

// 本輪即時售出張數——來自 refreshHot() 對所有 RSA shard 的 shardSalesCount 加總
const ticketsSoldThisRound = computed(() => contractStore.ticketsSoldThisRound)

// 本輪目前已增加的頭獎金額（RSA 票款 50% 分帳估算，已扣除各 shard 的 1000 sats dust，
// 與 totalJackpotSats 共用同一份 estimateJackpotShare() 邏輯）
const roundJackpotAddedBch = computed(() => {
  const sats = contractStore.roundJackpotContributionSats
  return (Number(sats) / 1e8).toFixed(6)
})

// 本期贊助頭獎——已經直接併入 jackpotSats（playerDonation() 當下就寫進 JP NFT value），
// 這裡純粹是「本期」拆分顯示，不重複計入 totalJackpotSats
const roundDonationBch = computed(() => {
  const sats = contractStore.roundDonationSats
  return (Number(sats) / 1e8).toFixed(6)
})

const canPickNumbers = computed(() =>
  normalNums.value.length === 3 && specialNums.value.length === 1
)

const canBuy = computed(() =>
  walletStore.isConnected &&
  ticketCart.value.length > 0 &&
  buyState.status === 'idle'
)

const buyButtonLabel = computed(() => {
  if (walletStore.status === 'connecting') return t('wallet.connecting')
  if (!walletStore.isConnected) return t('picker.connect_to_buy')
  if (ticketCart.value.length === 0) return t('picker.btn_buy')
  return t('picker.btn_buy_n', { n: ticketCart.value.length })
})

const directBuyButtonLabel = computed(() => {
  if (ticketCart.value.length === 0) return t('direct_buy.btn_label')
  return t('direct_buy.btn_label_n', { n: ticketCart.value.length })
})

// 告知玩家本次購買實際會落在哪一期，避免與正在開獎的上一期混淆
const buyConfirmMessage = computed(() => {
  const base = t('picker.buy_confirm_message', { round: contractStore.purchaseRound })
  if (contractStore.drawingRoundActive && contractStore.drawingRoundNumber !== null) {
    return `${base} ${t('picker.buy_confirm_drawing_notice', { round: contractStore.drawingRoundNumber })}`
  }
  return base
})

function pickRandom(total: number, count: number): number[] {
  const nums: number[] = []
  while (nums.length < count) {
    const r = Math.floor(Math.random() * total) + 1
    if (!nums.includes(r)) nums.push(r)
  }
  return nums
}

function randomPickAll() {
  normalNums.value = pickRandom(32, 3)
  specialNums.value = pickRandom(16, 1)
}

function clearAllNums() {
  normalNums.value = []
  specialNums.value = []
}

function addToCart() {
  if (!canPickNumbers.value) return
  if (ticketCart.value.length >= maxTickets) {
    showToast(t('picker.cart_full'), 'warning')
    return
  }
  const [n1, n2, n3] = [...normalNums.value].sort((a, b) => a - b)
  const s = specialNums.value[0]
  const isDuplicate = ticketCart.value.some(
    e => e.n1 === n1 && e.n2 === n2 && e.n3 === n3 && e.s === s,
  )
  if (isDuplicate) {
    showToast(t('picker.cart_duplicate'), 'warning')
    return
  }
  ticketCart.value.push({ n1, n2, n3, s })
}

function removeFromCart(idx: number) {
  ticketCart.value.splice(idx, 1)
}

function clearCart() {
  ticketCart.value = []
}

function openDirectBuy() {
  recoveredDeposit.value = null
  showDirectBuyModal.value = true
}

async function onBuyButtonClick() {
  if (!walletStore.isConnected) {
    try {
      await walletStore.connectWalletConnect()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
    return
  }
  if (!canBuy.value) return
  showBuyConfirm.value = true
}

async function confirmBuyFromModal() {
  showBuyConfirm.value = false
  await buy()
}

async function buy() {
  if (!canBuy.value) return
  buyReset()

  await buyExecute({ tickets: ticketCart.value })

  if (buyState.status === 'success') {
    lastPurchase.value = {
      tickets: [...ticketCart.value],
      round: contractStore.purchaseRound,
      totalPriceBch: totalPriceBch.value,
      txid: buyState.txid,
    }
    showPurchaseSuccessModal.value = true
    normalNums.value = []
    specialNums.value = []
    ticketCart.value = []
    buyReset()
    if (walletStore.address) {
      await ticketStore.fetchForAddress(walletStore.address)
    }
    // 買票只會動到 RSA shard 的售票張數/金額（熱資料），不影響 RSC/JP/FPP 等冷資料
    await contractStore.refreshHot()
  } else if (buyState.status === 'error') {
    showToast(buyState.error ?? t('toast.tx_broadcast'), 'error')
    buyReset()
  }
}
</script>

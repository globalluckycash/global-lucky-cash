<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 modal-overlay"
        @click.self="onBackdrop"
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
            {{ t('direct_buy.title') }}
          </h2>

          <!-- Round notice: tells the player which round this purchase will count toward,
               so it isn't confused with a previous round that may still be drawing -->
          <div class="mb-4 px-4 py-3 rounded-2xl bg-bch/10 border border-bch/20 text-sm font-bold text-bch flex items-center gap-2">
            <i class="fa-solid fa-circle-info" />
            {{ t('direct_buy.round_notice', { round: contractStore.purchaseRound }) }}
          </div>
          <div
            v-if="contractStore.drawingRoundActive && contractStore.drawingRoundNumber !== null"
            class="mb-4 px-4 py-3 rounded-2xl bg-yellow-500/5 border border-yellow-500/20 text-xs text-yellow-400/90 leading-relaxed"
          >
            {{ t('direct_buy.drawing_notice', { round: contractStore.drawingRoundNumber }) }}
          </div>

          <!-- Selected numbers summary -->
          <div class="text-xs text-gray-500 mb-2">
            {{ t('direct_buy.ticket_count', { n: tickets.length }) }}
          </div>
          <div class="space-y-2 bg-black/30 rounded-2xl p-4 mb-6">
            <div
              v-for="(ticket, idx) in tickets"
              :key="idx"
              class="flex items-center gap-2 flex-wrap"
            >
              <span class="text-xs text-gray-500 font-mono w-5 shrink-0">#{{ idx + 1 }}</span>
              <NumberBall v-for="n in [ticket.n1, ticket.n2, ticket.n3]" :key="n" :number="n" color="green" />
              <span class="text-gray-600 mx-1">+</span>
              <NumberBall :number="ticket.s" color="purple" />
            </div>
          </div>

          <!-- ─── Step 1: Address input ─── -->
          <template v-if="internalStep === 'address_input'">
            <p class="text-gray-400 text-sm mb-4">{{ t('direct_buy.address_desc') }}</p>

            <div class="space-y-2 mb-5">
              <label class="text-xs text-gray-500 font-semibold uppercase tracking-wider">
                {{ t('direct_buy.receiver_label') }}
              </label>
              <div class="flex gap-2">
                <input
                  v-model="receiverAddress"
                  @input="validateAddress"
                  :placeholder="t('direct_buy.address_placeholder')"
                  spellcheck="false"
                  class="flex-1 min-w-0 bg-black/40 border rounded-xl px-4 py-3 text-sm font-mono text-white focus:outline-none transition placeholder:text-gray-600"
                  :class="addressState === 'valid'
                    ? 'border-green-500/50 focus:border-green-500/70'
                    : addressState === 'invalid'
                      ? 'border-red-500/50 focus:border-red-500/70'
                      : 'border-white/10 focus:border-bch/40'"
                />
                <button
                  type="button"
                  @click="pasteAddress"
                  class="shrink-0 px-4 rounded-xl border border-white/10 text-gray-400 hover:text-bch hover:border-bch/40 transition text-xs font-bold flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-paste" />{{ t('direct_buy.paste') }}
                </button>
              </div>
              <p v-if="addressState === 'invalid'" class="text-red-400 text-xs">
                <i class="fa-solid fa-circle-xmark mr-1" />{{ addressError }}
              </p>
              <p v-else-if="addressState === 'valid'" class="text-green-400 text-xs">
                <i class="fa-solid fa-circle-check mr-1" />{{ t('direct_buy.address_valid') }}
              </p>
              <p v-else class="text-gray-600 text-xs">{{ t('direct_buy.address_hint') }}</p>
            </div>

            <button
              :disabled="addressState !== 'valid' || tickets.length === 0 || quotingDeposit"
              @click="proceedToDeposit"
              class="w-full py-4 rounded-2xl font-black text-lg transition"
              :class="addressState === 'valid' && tickets.length > 0 && !quotingDeposit
                ? 'bg-bch hover:shadow-neon-strong text-black'
                : 'bg-bch/20 text-black/40 cursor-not-allowed'"
            >
              {{ quotingDeposit ? t('direct_buy.quoting') : t('direct_buy.next') }}
            </button>
          </template>

          <!-- ─── Step 2: Deposit info ─── -->
          <template v-else-if="internalStep === 'deposit_info' && depositInfo && state.status === 'idle'">
            <div class="space-y-4 mb-5">
              <!-- Amount to send -->
              <div class="bg-black/30 rounded-2xl p-4">
                <div class="text-xs text-gray-500 mb-1">{{ t('direct_buy.send_amount') }}</div>
                <div class="text-3xl font-black text-bch">{{ depositInfo.depositAmountBch }} BCH</div>
                <div class="text-white/30 font-mono text-xs mt-0.5">
                  ≈ ${{ formatUsd(depositInfo.depositAmountSats, depositInfo.rate) }} USD
                </div>
                <div class="text-xs text-yellow-500/70 mt-1">
                  <i class="fa-solid fa-triangle-exclamation mr-1" />{{ t('direct_buy.rate_disclaimer') }}
                </div>
              </div>

              <!-- Deposit address -->
              <div class="bg-black/30 rounded-2xl p-4">
                <div class="text-xs text-gray-500 mb-2">{{ t('direct_buy.deposit_address') }}</div>

                <!-- QR code -->
                <div v-if="qrDataUrl" class="flex justify-center mb-3">
                  <img :src="qrDataUrl" alt="QR Code" class="rounded-xl" width="180" height="180" />
                </div>

                <div class="font-mono text-xs text-white/80 break-all leading-relaxed select-all">
                  {{ paymentUri }}
                </div>
                <button
                  @click="copyAddress"
                  class="mt-3 flex items-center gap-1.5 text-xs transition font-semibold"
                  :class="copied ? 'text-green-400' : 'text-bch hover:text-bch/80'"
                >
                  <i :class="copied ? 'fa-solid fa-circle-check' : 'fa-regular fa-copy'" />
                  {{ copied ? t('direct_buy.copied') : t('direct_buy.copy_address') }}
                </button>
              </div>

              <!-- Instructions -->
              <div class="bg-bch/5 border border-bch/10 rounded-2xl p-4 text-xs text-gray-400 leading-relaxed space-y-1.5">
                <p><span class="text-bch font-bold">①</span> {{ t('direct_buy.step1') }}</p>
                <p><span class="text-bch font-bold">②</span> {{ t('direct_buy.step2') }}</p>
                <p><span class="text-bch font-bold">③</span> {{ t('direct_buy.step3') }}</p>
              </div>

              <!-- This order's recovery info is now baked into the page URL — see url_recovery_hint -->
              <p class="text-xs text-gray-500 leading-relaxed flex items-start gap-2">
                <i class="fa-solid fa-bookmark mt-0.5 shrink-0" />
                {{ t('direct_buy.url_recovery_hint') }}
              </p>
            </div>

            <div class="space-y-3">
              <div class="relative">
                <button
                  @click="confirmBuy"
                  class="w-full py-3 rounded-2xl bg-bch hover:shadow-neon-strong text-black font-black text-sm transition"
                >
                  {{ t('direct_buy.confirm_buy') }}
                </button>
                <SdkSourceHint
                  :sdk-url="buyTicketsViaDepositSdkUrl"
                  class="absolute top-1/2 right-1.5 -translate-y-1/2"
                  icon-class="text-black/40 hover:text-black/70"
                  side="top"
                />
              </div>
              <div class="flex gap-3">
                <button
                  @click="internalStep = 'address_input'"
                  class="px-5 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold text-sm transition"
                >
                  {{ t('direct_buy.back') }}
                </button>
                <div class="relative flex-1">
                  <button
                    type="button"
                    @click="refundBuy"
                    class="w-full py-3 rounded-2xl border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 font-bold text-sm transition"
                  >
                    {{ t('direct_buy.confirm_refund') }}
                  </button>
                  <SdkSourceHint
                    :sdk-url="refundTicketDepositSdkUrl"
                    class="absolute top-1/2 right-1.5 -translate-y-1/2"
                    side="top"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- ─── Executing ─── -->
          <template v-else-if="state.status === 'checking' || state.status === 'executing' || state.status === 'retrying'">
            <div class="flex flex-col items-center gap-4 py-10">
              <i class="fa-solid fa-gear spinner text-bch text-4xl" />
              <p class="text-gray-300 font-semibold text-center">
                <template v-if="state.status === 'checking'">{{ t('direct_buy.checking') }}</template>
                <template v-else-if="state.status === 'retrying'">
                  {{ t('errors.utxo_race_retrying', { attempt: state.retryAttempt, max: MAX_UTXO_RACE_RETRIES }) }}
                </template>
                <template v-else>{{ lastAction === 'refund' ? t('direct_buy.refund_executing') : t('direct_buy.executing') }}</template>
              </p>
            </div>
          </template>

          <!-- ─── Success ─── -->
          <template v-else-if="state.status === 'success'">
            <div class="text-center py-4 space-y-4">
              <div class="flex items-center justify-center gap-3 text-bch">
                <i class="fa-solid fa-circle-check text-4xl" />
                <span class="font-black text-2xl">{{ lastAction === 'refund' ? t('direct_buy.refund_success_title') : t('direct_buy.success_title') }}</span>
              </div>
              <p class="text-gray-400 text-sm">{{ lastAction === 'refund' ? t('direct_buy.refund_success_desc') : t('direct_buy.success_desc') }}</p>
              <div v-if="state.txid" class="bg-black/30 rounded-xl p-3">
                <div class="text-xs text-gray-500 mb-1">TXID</div>
                <div class="font-mono text-xs text-bch break-all">{{ state.txid }}</div>
              </div>
              <div class="flex gap-3 justify-center">
                <button
                  @click="$emit('close')"
                  class="px-6 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
                >
                  {{ t('direct_buy.close') }}
                </button>
                <a
                  v-if="state.txid"
                  :href="explorerTxUrl(state.txid)"
                  target="_blank"
                  rel="noopener"
                  class="px-6 py-3 rounded-2xl bg-bch/20 text-bch border border-bch/30 font-bold hover:bg-bch/30 transition"
                >
                  {{ t('direct_buy.view_tx') }}
                </a>
              </div>
            </div>
          </template>

          <!-- ─── Error ─── -->
          <template v-else-if="state.status === 'error'">
            <div class="space-y-4">
              <div class="flex items-start gap-3 text-red-400 bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
                <i class="fa-solid fa-circle-xmark text-xl mt-0.5 shrink-0" />
                <span class="text-sm leading-relaxed">{{ state.error }}</span>
              </div>
              <button
                @click="retryBuy"
                class="w-full py-3 rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30 font-bold hover:bg-red-500/30 transition"
              >
                <i class="fa-solid fa-rotate-right mr-1.5" />{{ t('direct_buy.retry') }}
              </button>
              <div class="flex gap-3">
                <button
                  @click="$emit('close')"
                  class="flex-1 py-3 rounded-2xl border border-white/10 text-gray-400 hover:bg-white/5 font-bold transition"
                >
                  {{ t('direct_buy.close') }}
                </button>
                <!-- Refund: recovers the deposit if buyTicket() can never succeed for it again
                     (e.g. the RSA round advanced after the deposit was made) -->
                <button
                  @click="refundBuy"
                  class="flex-1 py-3 rounded-2xl border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 font-bold text-sm transition"
                >
                  <i class="fa-solid fa-rotate-left mr-1.5" />{{ t('direct_buy.refund') }}
                </button>
              </div>
              <p class="text-xs text-gray-500 text-center leading-relaxed">{{ t('direct_buy.refund_hint') }}</p>
            </div>
          </template>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import NumberBall from '@/components/NumberBall.vue'
import SdkSourceHint from '@/components/SdkSourceHint.vue'
import { validateReceiverAddress, computeDepositInfo, useDirectBuy } from '@/composables/useDirectBuy'
import { MAX_UTXO_RACE_RETRIES } from '@/lib/broadcastRetry'
import { encodeDepositParam } from '@/lib/depositRecoveryUrl'
import { fetchRandomRSAShard } from '@/lib/electrum'
import { useContractStore } from '@/stores/contract'
import { explorerTxUrl } from '@/lib/explorer'
import { useToast } from '@/composables/useToast'
import { getComposableSourceUrl } from '@/lib/contractConfig'
import type { DepositInfo } from '@/composables/useDirectBuy'
import type { LotteryNumber } from '@/composables/useBuyTicket'

const { t } = useI18n()
const buyTicketsViaDepositSdkUrl = getComposableSourceUrl('useDirectBuy.ts')
const refundTicketDepositSdkUrl = getComposableSourceUrl('useDirectBuy.ts')
const contractStore = useContractStore()
const { showToast } = useToast()
const route = useRoute()
const router = useRouter()

const props = defineProps<{
  visible: boolean
  tickets: LotteryNumber[]  // 1-10 distinct number sets to purchase in this deposit
  // Set by HomeView when the page URL already carries a recoverable order (see
  // depositRecoveryUrl.ts) — skips straight to the deposit_info step instead of address_input.
  recovered?: { round: number; buyerAddress: string; buyerPkh: Uint8Array } | null
}>()

const emit = defineEmits<{
  close: []
}>()

// ─── Internal state ────────────────────────────────────────────────────────

type Step = 'address_input' | 'deposit_info'
const internalStep = ref<Step>('address_input')

const receiverAddress = ref('')
const addressState = ref<'idle' | 'valid' | 'invalid'>('idle')
const addressError = ref('')
let buyerPkh: Uint8Array | null = null

const depositInfo = ref<DepositInfo | null>(null)
const quotingDeposit = ref(false)
const copied = ref(false)
const qrDataUrl = ref('')
const paymentUri = ref('')
const lastAction = ref<'buy' | 'refund'>('buy')

const { state, execute, refund, reset } = useDirectBuy()

// Reset all state when modal is opened so a new purchase can start fresh
watch(() => props.visible, (visible) => {
  if (visible) {
    internalStep.value = 'address_input'
    receiverAddress.value = ''
    addressState.value = 'idle'
    addressError.value = ''
    buyerPkh = null
    depositInfo.value = null
    quotingDeposit.value = false
    copied.value = false
    qrDataUrl.value = ''
    paymentUri.value = ''
    lastAction.value = 'buy'
    reset()

    if (props.recovered) {
      receiverAddress.value = props.recovered.buyerAddress
      addressState.value = 'valid'
      buyerPkh = props.recovered.buyerPkh
      advanceToDepositInfo(props.recovered.round, props.recovered.buyerAddress, props.recovered.buyerPkh)
    }
  }
})

// Order fully resolved (bought or refunded) — the URL no longer needs to carry it.
watch(() => state.status, (status) => {
  if (status === 'success') {
    clearDepositUrlParam()
    contractStore.refreshHot()
  }
})

// ─── Address validation ────────────────────────────────────────────────────

function validateAddress() {
  const addr = receiverAddress.value.trim()
  if (!addr) {
    addressState.value = 'idle'
    addressError.value = ''
    buyerPkh = null
    return
  }
  const result = validateReceiverAddress(addr)
  if (result.valid) {
    addressState.value = 'valid'
    addressError.value = ''
    buyerPkh = result.pkh
  } else {
    addressState.value = 'invalid'
    addressError.value = result.error
    buyerPkh = null
  }
}

// ─── Navigation ────────────────────────────────────────────────────────────

async function proceedToDeposit() {
  if (!buyerPkh) return
  // A recovered order keeps its original round even after navigating back to this step —
  // switching to the live purchaseRound here would silently compute a different address.
  const round = props.recovered?.round ?? contractStore.purchaseRound
  await advanceToDepositInfo(round, receiverAddress.value.trim(), buyerPkh)
}

/**
 * Compute the deposit address/amount for (round, tickets, buyerAddress, buyerPkh) and move to
 * the deposit_info step — shared by the fresh address_input flow and the URL-recovered flow
 * (see the `recovered` prop above). `round` must be the round the order was created under, not
 * necessarily contractStore.purchaseRound, since a recovered order may predate a round advance.
 *
 * The quoted amount is priced off the actual RSA shard's committed exchangeRate for `round`
 * (the same value execute()'s minRequired check reads at broadcast time), not the live-updating
 * RSC stagedRate — that rate is locked in per round at settle() time and only changes on the
 * next round switch, so this quote can't go stale from real-world market movement the way
 * stagedRate could.
 *
 * As soon as this resolves, the order (round + lotteryNumbers + buyerPkh) is encoded into the
 * page URL — before any deposit is sent — so closing or reloading the tab can't lose it; see
 * depositRecoveryUrl.ts.
 */
async function advanceToDepositInfo(round: number, buyerAddress: string, pkh: Uint8Array) {
  if (props.tickets.length === 0) return

  let rate: number
  quotingDeposit.value = true
  try {
    const rsaShard = await fetchRandomRSAShard(round)
    rate = rsaShard.shardState.exchangeRate
  } catch {
    showToast(t('direct_buy.rate_fetch_failed'), 'error')
    return
  } finally {
    quotingDeposit.value = false
  }

  const info = computeDepositInfo(round, props.tickets, buyerAddress, pkh, rate)
  depositInfo.value = info
  reset()

  // BCH payment URI: ADDRESS?amount=AMOUNT_BCH — shared by the QR code and the copy button
  // so a wallet that supports the ?amount= param pre-fills the exact amount to send.
  paymentUri.value = `${info.depositAddress}?amount=${info.depositAmountBch}`
  qrDataUrl.value = await QRCode.toDataURL(paymentUri.value, { width: 200, margin: 1 })

  internalStep.value = 'deposit_info'

  // push, not replace — replace only rewrites the current history entry, so the browser never
  // records this URL as a visited page and the player can't get back to it via the back button
  // or browser history if the tab navigates away before the deposit is sent.
  const dep = encodeDepositParam({ round, lotteryNumbers: info.lotteryNumbers, buyerPkh: pkh })
  router.push({ query: { ...route.query, dep } })
}

function clearDepositUrlParam() {
  if (!('dep' in route.query)) return
  const query = { ...route.query }
  delete query.dep
  router.replace({ query })
}

async function confirmBuy() {
  if (!depositInfo.value) return
  lastAction.value = 'buy'
  await execute(depositInfo.value)
}

async function retryBuy() {
  if (!depositInfo.value) {
    reset()
    internalStep.value = 'address_input'
    return
  }
  reset()
  lastAction.value = 'buy'
  await execute(depositInfo.value)
}

async function refundBuy() {
  if (!depositInfo.value) return
  lastAction.value = 'refund'
  await refund(depositInfo.value)
}

// ─── Copy address ──────────────────────────────────────────────────────────

async function copyAddress() {
  if (!paymentUri.value) return

  // navigator.clipboard is undefined on non-HTTPS origins and some mobile in-app browsers
  // (wallet/QR-scanner webviews), and can also reject even when present (permission denied) —
  // fall back to the legacy execCommand path, and surface a toast if both fail instead of the
  // button silently doing nothing.
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(paymentUri.value)
    } else if (!copyViaExecCommand(paymentUri.value)) {
      throw new Error('execCommand copy failed')
    }
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    if (copyViaExecCommand(paymentUri.value)) {
      copied.value = true
      setTimeout(() => { copied.value = false }, 2000)
    } else {
      showToast(t('direct_buy.copy_failed'), 'error')
    }
  }
}

async function pasteAddress() {
  try {
    if (!navigator.clipboard?.readText) throw new Error('clipboard.readText unavailable')
    const text = await navigator.clipboard.readText()
    receiverAddress.value = text.trim()
    validateAddress()
  } catch {
    showToast(t('direct_buy.paste_failed'), 'error')
  }
}

function copyViaExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  return ok
}

// ─── Backdrop / close ─────────────────────────────────────────────────────

function onBackdrop() {
  if (state.status === 'checking' || state.status === 'executing' || state.status === 'retrying') return
  emit('close')
}


// rate = USD/BCH × 100 (ATTESTATION_SCALING)
function formatUsd(sats: bigint, rate: number): string {
  if (!rate) return '0.00'
  const bch = Number(sats) / 1e8
  const usd = bch * (rate / 100)
  return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

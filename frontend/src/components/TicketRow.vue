<template>
  <div class="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div class="flex items-center gap-2 flex-wrap">
      <NumberBall v-for="n in [ticket.n1, ticket.n2, ticket.n3]" :key="n" :number="n" color="green" />
      <span class="text-gray-600 mx-1">+</span>
      <NumberBall :number="ticket.s" color="purple" />
    </div>

    <div class="flex items-center gap-2 flex-wrap justify-end">
      <!-- Claim status badge -->
      <span
        v-if="showClaimStatusBadge"
        :class="[
          'px-2 py-0.5 rounded-full text-xs font-bold',
          ticket.claimStatus === 0
            ? 'bg-bch/20 text-bch'
            : 'bg-gray-700 text-gray-400',
        ]"
      >
        {{ claimStatusLabel }}
      </span>

      <!-- Prize level badge -->
      <span
        v-if="ticket.prizeLevel && ticket.prizeLevel !== 'none'"
        :class="[
          'px-2 py-0.5 rounded-full text-xs font-bold flex items-center gap-1.5',
          ticket.prizeLevel === 'jackpot'
            ? 'bg-yellow-500/20 text-yellow-400'
            : 'bg-bch/20 text-bch',
        ]"
      >
        <span class="flex items-center gap-0.5" aria-hidden="true">
          <i
            v-for="j in 3"
            :key="j"
            class="text-[7px]"
            :class="j <= prizeMatchPattern.normal ? 'fa-solid fa-circle' : 'fa-regular fa-circle opacity-30'"
          ></i>
          <i
            class="text-[10px] ml-0.5"
            :class="prizeMatchPattern.special ? 'fa-solid fa-star' : 'fa-regular fa-star opacity-30'"
          ></i>
        </span>
        {{ prizeLevelLabel }}
      </span>
      <span v-else-if="ticket.prizeLevel === 'none'" class="px-2 py-0.5 rounded-full text-xs font-bold bg-gray-700 text-gray-500">
        {{ t('ticket.no_prize') }}
      </span>
      <span v-else-if="!isRefundEligible" class="px-2 py-0.5 rounded-full text-xs font-bold bg-gray-700 text-gray-500">
        {{ t('ticket.pending_draw') }}
      </span>

      <button
        v-if="showClaimButton"
        class="px-4 py-1.5 rounded-xl text-sm font-bold transition"
        :class="claimButtonDisabled
          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
          : 'bg-bch text-black hover:shadow-neon'"
        :disabled="claimButtonDisabled"
        @click="onClaim"
      >
        {{ claimButtonLabel }}
      </button>
    </div>
  </div>

  <!-- Claim modal -->
  <ClaimModal
    :visible="modalVisible"
    :tx-state="claimState"
    :variant="modalVariant"
    :prize-amount-bch="estimatedPrizeBch"
    @confirm="executeClaim"
    @close="closeModal"
    @retry="executeClaim"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ParsedTicket, JPNftState } from '@/types'
import NumberBall from './NumberBall.vue'
import ClaimModal from './ClaimModal.vue'
import { useClaimFixedPrize } from '@/composables/useClaimFixedPrize'
import { useClaimJackpot } from '@/composables/useClaimJackpot'
import { useClaimCanceledRoundRefund } from '@/composables/useClaimCanceledRoundRefund'
import { fetchAllJackpotPools } from '@/lib/electrum'
import { useContractStore } from '@/stores/contract'
import { useTicketStore } from '@/stores/ticket'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const contractStore = useContractStore()
const ticketStore = useTicketStore()
const { showToast } = useToast()

const props = defineProps<{ ticket: ParsedTicket }>()

const { state: fixedState, execute: executeFixed, reset: resetFixed, newTicketUtxo: fixedNewTicketUtxo } = useClaimFixedPrize()
const { state: jackpotState, execute: executeJackpot, reset: resetJackpot, newTicketUtxo: jackpotNewTicketUtxo } = useClaimJackpot()
const { state: refundState, execute: executeRefund, reset: resetRefund, newTicketUtxo: refundNewTicketUtxo } = useClaimCanceledRoundRefund()

const modalVisible = ref(false)
const jpUtxoForClaim = ref<Awaited<ReturnType<typeof fetchAllJackpotPools>>[0] | null>(null)

// 該張彩票所屬輪次已被取消（cancelDraw，開獎逾期取消），且尚未領獎/退款——可申請退款；
// 這與中獎領獎互斥（輪次一旦被取消就不會再有開獎結果，prizeLevel 恆為 null）
const isRefundEligible = computed(() =>
  props.ticket.claimStatus === 0 && ticketStore.canceledRounds.has(props.ticket.round)
)

const modalVariant = computed<'fixed' | 'jackpot' | 'refund'>(() => {
  if (isRefundEligible.value) return 'refund'
  return props.ticket.prizeLevel === 'jackpot' ? 'jackpot' : 'fixed'
})

const claimState = computed(() => {
  if (isRefundEligible.value) return refundState
  return props.ticket.prizeLevel === 'jackpot' ? jackpotState : fixedState
})

const prizeLevelLabel = computed(() => {
  const map: Record<string, string> = {
    jackpot: t('ticket.prize_jackpot'),
    fixed4: t('ticket.prize_fixed4'),
    fixed3: t('ticket.prize_fixed3'),
    fixed2: t('ticket.prize_fixed2'),
    fixed1: t('ticket.prize_fixed1'),
  }
  return map[props.ticket.prizeLevel ?? ''] ?? ''
})

// 中獎徽章的視覺圓點/星星：普通號命中數(0~3) + 特別號是否命中，對應各 prizeLevel 的固定中獎組合
const PRIZE_MATCH_PATTERN: Record<string, { normal: number; special: boolean }> = {
  jackpot: { normal: 3, special: true },
  fixed4: { normal: 3, special: false },
  fixed3: { normal: 2, special: true },
  fixed2: { normal: 1, special: true },
  fixed1: { normal: 0, special: true },
}
const prizeMatchPattern = computed(() => PRIZE_MATCH_PATTERN[props.ticket.prizeLevel ?? ''] ?? { normal: 0, special: false })

// Expiry only applies to jackpot tickets
const isJackpotExpired = ref(false)

// Estimate prize BCH for the modal
const estimatedPrizeBch = computed<string | undefined>(() => {
  if (!jpUtxoForClaim.value) return undefined
  const jpVal = jpUtxoForClaim.value.utxo.valueSats
  const claimCount = jpUtxoForClaim.value.state.claimCount
  if (!claimCount) return undefined
  const share = Number(jpVal) / claimCount / 1e8
  return share.toFixed(4)
})

// Claim status badge label — 低nibble非0(已領頭獎或固定獎一~四獎之一) / bit4(0x10)已退款 / 未領獎
const claimStatusLabel = computed(() => {
  if ((props.ticket.claimStatus & 0x10) !== 0) return t('ticket.refunded')
  if ((props.ticket.claimStatus & 0x0f) !== 0) return t('ticket.claimed')
  return t('ticket.unclaimed')
})

// 只有「claimStatus 非 0（已領獎/已退款）」或「claimStatus 為 0 但真的有獎金/退款可領」時
// 才顯示此徽章；未中獎、或尚未開獎的彩票不該顯示「未領獎」，否則會讓玩家誤會還有獎金沒領
const showClaimStatusBadge = computed(() => {
  if (props.ticket.claimStatus !== 0) return true
  const level = props.ticket.prizeLevel
  return (!!level && level !== 'none') || isRefundEligible.value
})

// Whether the claim/refund button should appear
const showClaimButton = computed(() => {
  if (isRefundEligible.value) return true
  const level = props.ticket.prizeLevel
  if (!level || level === 'none') return false
  if (props.ticket.claimStatus !== 0) return false  // already claimed (fixed prize)
  return true
})

const claimButtonDisabled = computed(() => {
  if (modalVariant.value === 'jackpot') {
    // disable if expired
    if (isJackpotExpired.value) return true
  }
  return false
})

const claimButtonLabel = computed(() => {
  return isRefundEligible.value ? t('ticket.refund') : t('ticket.claim')
})

async function onClaim() {
  // Load JP UTXO for jackpot claims
  if (!isRefundEligible.value && props.ticket.prizeLevel === 'jackpot') {
    let allJp: Awaited<ReturnType<typeof fetchAllJackpotPools>>
    try {
      allJp = await fetchAllJackpotPools()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
    const match = allJp.find(j =>
      j.state.currentDrawRound === props.ticket.round &&
      j.state.claimCount > 0
    )
    if (!match) {
      showToast('Jackpot pool not found for this round', 'error')
      return
    }
    jpUtxoForClaim.value = match
    const now = Math.floor(Date.now() / 1000)
    isJackpotExpired.value = now > Number(match.state.lastClaimTime)
  }
  modalVisible.value = true
}

async function executeClaim() {
  if (isRefundEligible.value) {
    await executeRefund({ ticketUtxo: props.ticket.utxo, round: props.ticket.round })
  } else if (props.ticket.prizeLevel === 'jackpot') {
    if (!jpUtxoForClaim.value) return
    await executeJackpot({ ticketUtxo: props.ticket.utxo, jpUtxo: jpUtxoForClaim.value.utxo })
  } else {
    const level = props.ticket.prizeLevel as 'fixed1' | 'fixed2' | 'fixed3' | 'fixed4'
    await executeFixed({ ticketUtxo: props.ticket.utxo, round: props.ticket.round, prizeLevel: level })
  }

  if (claimState.value.status === 'success') {
    showToast(t('toast.tx_broadcast'), 'success')
    // 交易剛廣播完成，electrum 尚未必來得及重新索引該地址的 UTXO，若此時再打
    // fetchForAddress 可能撈回舊狀態，把畫面又蓋回「未領獎」；改用已知的新
    // TicketNFT 內容直接樂觀更新，不必等鏈上索引也不必手動重新整理。
    const newTicketUtxo = isRefundEligible.value
      ? refundNewTicketUtxo.value
      : props.ticket.prizeLevel === 'jackpot' ? jackpotNewTicketUtxo.value : fixedNewTicketUtxo.value
    if (newTicketUtxo) {
      ticketStore.applyClaimed(props.ticket.utxo, newTicketUtxo)
    }
  }
}

function closeModal() {
  modalVisible.value = false
  resetFixed()
  resetJackpot()
  resetRefund()
}
</script>

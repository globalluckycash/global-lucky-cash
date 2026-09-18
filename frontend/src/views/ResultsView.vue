<template>
  <div class="flex-grow relative">
    <div class="absolute inset-0 grid-bg pointer-events-none"></div>
    <div class="max-w-4xl mx-auto px-4 py-12 relative z-10">
      <h1 class="text-3xl font-black mb-3">{{ t('results.title') }}</h1>
      <div class="flex items-start gap-3 border-l-2 border-bch/50 pl-4 mb-8">
        <i class="fa-solid fa-trophy text-bch/80 mt-1 shrink-0"></i>
        <p class="text-gray-400 leading-relaxed">{{ t('results.subtitle') }}</p>
      </div>

      <div v-if="loading" class="text-center text-gray-500 py-12">
        <i class="fa-solid fa-gear spinner mr-2 text-2xl"></i>
      </div>

      <div v-else-if="error" class="text-red-400 text-sm text-center py-8">
        <i class="fa-solid fa-triangle-exclamation mr-1"></i> {{ error }}
      </div>

      <div v-else-if="results.length === 0" class="text-center text-gray-500 py-12">
        <i class="fa-solid fa-inbox text-4xl mb-4 block opacity-30"></i>
        {{ t('results.no_results') }}
      </div>

      <div v-else class="space-y-4">
        <template v-for="item in results" :key="item.kind === 'drawn' ? `wn-${item.wn.drawRound}` : `cr-${item.round}`">
          <DrawResultCard
            v-if="item.kind === 'drawn'"
            :wn="item.wn"
            :jackpot-won="item.jackpotWon"
            :jackpot-amount-sats="item.jackpotAmountSats"
            :winner-count="item.winnerCount"
            :claimed-count="item.claimedCount"
            :can-process-expired="!!item.expiredJpUtxo"
            :processing="peState.status !== 'idle'"
            @process-expired="processExpired(item.expiredJpUtxo!)"
          />
          <CanceledRoundCard
            v-else
            :round="item.round"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DrawResultCard from '@/components/DrawResultCard.vue'
import CanceledRoundCard from '@/components/CanceledRoundCard.vue'
import { fetchWinningNumberHistory, fetchAllJackpotPools, fetchAllCanceledRounds } from '@/lib/electrum'
import { useProcessExpired } from '@/composables/useProcessExpired'
import { useToast } from '@/composables/useToast'
import type { WNNftState, Utxo } from '@/types'

const { t } = useI18n()
const { showToast } = useToast()
const { state: peState, execute: peExecute, reset: peReset } = useProcessExpired()

interface DrawnResultItem {
  kind: 'drawn'
  wn: WNNftState
  jackpotWon: boolean
  jackpotAmountSats?: bigint
  winnerCount?: number
  claimedCount?: number
  expiredJpUtxo?: Utxo
}

interface CanceledResultItem {
  kind: 'canceled'
  round: number
}

type ResultItem = DrawnResultItem | CanceledResultItem

const results = ref<ResultItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const activeJpUtxo = ref<Utxo | null>(null)

onMounted(loadResults)

async function loadResults() {
  loading.value = true
  error.value = null
  try {
    const [wnHistory, allJp, canceledRounds] = await Promise.all([
      fetchWinningNumberHistory(20),
      fetchAllJackpotPools(),
      fetchAllCanceledRounds(),
    ])

    const now = Math.floor(Date.now() / 1000)
    activeJpUtxo.value = allJp.find(j => j.state.winnerCount === 0)?.utxo ?? null

    const drawnItems: ResultItem[] = wnHistory.map(wn => {
      // Check if any existing JP pool matches this round
      const matchJp = allJp.find(j =>
        j.state.currentDrawRound === wn.drawRound &&
        (j.state.n1 !== 0 || j.state.n2 !== 0 || j.state.n3 !== 0 || j.state.s !== 0)
      )
      // winnerCount == 0 表示該輪沒有人中獎（JP 池仍會記錄該輪號碼，但非中獎池）
      const jackpotWon = !!matchJp && matchJp.state.winnerCount > 0
      const isExpired = !!matchJp && matchJp.state.claimCount > 0 && now > Number(matchJp.state.lastClaimTime)
      return {
        kind: 'drawn',
        wn,
        jackpotWon,
        // totalBCH 於 verifyWin() 當下凍結為中獎總額，之後不隨領獎/逾期而變動（不可用會遞減的 UTXO 餘額）
        jackpotAmountSats: jackpotWon ? matchJp!.state.totalBCH : undefined,
        winnerCount: jackpotWon ? matchJp!.state.winnerCount : undefined,
        claimedCount: jackpotWon ? matchJp!.state.winnerCount - matchJp!.state.claimCount : undefined,
        expiredJpUtxo: isExpired ? matchJp!.utxo : undefined,
      }
    })

    // 取消輪次不會有 WinningNumberNFT（cancelDraw 是取代開獎完成，而非開獎的一種結果），
    // 故與開獎結果分開取得，再依期數合併排序，讓玩家知道這幾期沒有開獎號碼是因為被取消，而非資料遺漏。
    // 不顯示售出張數：CanceledRoundNFT.cumulativeSales 只是取消當下 DrawingNFT 記錄的累積售出彩票，
    // 顯示出來容易被誤解為與其他期一致口徑的總銷量
    const canceledItems: ResultItem[] = canceledRounds.map(cr => ({
      kind: 'canceled',
      round: cr.state.round,
    }))

    results.value = [...drawnItems, ...canceledItems].sort((a, b) => {
      const roundA = a.kind === 'drawn' ? a.wn.drawRound : a.round
      const roundB = b.kind === 'drawn' ? b.wn.drawRound : b.round
      return roundB - roundA
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function processExpired(expiredJpUtxo: Utxo) {
  if (!activeJpUtxo.value) {
    showToast('Cannot find active jackpot pool', 'error')
    return
  }
  try {
    await peExecute({ expiredJpUtxo, activeJpUtxo: activeJpUtxo.value })
    if (peState.status === 'success') {
      showToast(t('toast.tx_broadcast'), 'success')
      peReset()
      await loadResults()
    } else if (peState.status === 'error') {
      showToast(peState.error ?? t('errors.unknown_error'), 'error')
      peReset()
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'error')
  }
}
</script>

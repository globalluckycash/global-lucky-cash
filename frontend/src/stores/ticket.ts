import { ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchPlayerTickets, fetchAllCanceledRounds, fetchWinningNumberHistory } from '@/lib/electrum'
import { parseTicketCommitment } from '@/lib/nftDecode'
import type { ParsedTicket, PrizeLevel, WNNftState, Utxo } from '@/types'

function computePrizeLevel(
  ticket: { n1: number; n2: number; n3: number; s: number },
  wn: WNNftState
): PrizeLevel {
  const tnums = new Set([ticket.n1, ticket.n2, ticket.n3])
  const normalMatch = [wn.n1, wn.n2, wn.n3].filter(n => tnums.has(n)).length
  const specialMatch = ticket.s === wn.s

  if (normalMatch === 3 && specialMatch)  return 'jackpot'
  if (normalMatch === 3 && !specialMatch) return 'fixed4'
  if (normalMatch === 2 && specialMatch)  return 'fixed3'
  if (normalMatch === 1 && specialMatch)  return 'fixed2'
  if (normalMatch === 0 && specialMatch)  return 'fixed1'
  return 'none'
}

export const useTicketStore = defineStore('ticket', () => {
  const tickets = ref<ParsedTicket[]>([])
  const loading = ref(false)
  // 已被取消（cancelDraw，開獎逾期取消）的輪次，供彩票列表判斷哪些期數可申請退款
  const canceledRounds = ref<Set<number>>(new Set())

  async function fetchForAddress(cashAddr: string): Promise<void> {
    loading.value = true
    try {
      // 抓完整開獎歷史（而非只抓最新一期），這樣舊期數已開獎但未領獎/未中獎的彩票
      // 才能正確算出 prizeLevel，而不是全部落回 null（誤判成「尚未開獎」）
      const [raw, crEntries, wnHistory] = await Promise.all([
        fetchPlayerTickets(cashAddr),
        fetchAllCanceledRounds(),
        fetchWinningNumberHistory(1000),
      ])
      const wnByRound = new Map(wnHistory.map(wn => [wn.drawRound, wn]))
      tickets.value = raw.map(t => {
        const wn = wnByRound.get(t.round)
        return { ...t, prizeLevel: wn ? computePrizeLevel(t, wn) : null }
      })
      canceledRounds.value = new Set(crEntries.map(e => e.state.round))
    } finally {
      loading.value = false
    }
  }

  function clear() {
    tickets.value = []
    canceledRounds.value = new Set()
  }

  // 領獎交易一廣播成功，就用已知的新 TicketNFT commitment 樂觀更新狀態（claimStatus 等
  // 欄位），不必等 electrum 重新索引該地址的 UTXO 才能看到「已領獎」，避免使用者要手動
  // 重新整理頁面
  function applyClaimed(oldUtxo: Utxo, newUtxo: Utxo) {
    const idx = tickets.value.findIndex(t => t.utxo.txid === oldUtxo.txid && t.utxo.vout === oldUtxo.vout)
    if (idx === -1) return
    const ticket = tickets.value[idx]
    tickets.value[idx] = {
      ...ticket,
      ...parseTicketCommitment(newUtxo.token!.nft!.commitment),
      utxo: newUtxo,
    }
  }

  return { tickets, loading, canceledRounds, fetchForAddress, clear, applyClaimed }
})

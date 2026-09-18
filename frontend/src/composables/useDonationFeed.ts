import { ref, computed } from 'vue'
import { fetchDonationMessageEntries, fetchDonationMessageText, type DonationMessageEntry } from '@/lib/electrum'

const BATCH_SIZE = 20

/**
 * Data layer for the donation wall. Fetches the full lightweight donation list (round/amount/hash)
 * upfront, then resolves message text in batches as the user scrolls (each message needs an
 * extra raw-tx query).
 */
export function useDonationFeed() {
  const allEntries = ref<DonationMessageEntry[]>([])
  const messages = ref<Map<string, string | null>>(new Map())
  const loadingMessages = ref<Set<string>>(new Set())
  const visibleCount = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const visibleEntries = computed(() => allEntries.value.slice(0, visibleCount.value))
  const hasMore = computed(() => visibleCount.value < allEntries.value.length)

  async function resolveMessages(entries: DonationMessageEntry[]): Promise<void> {
    await Promise.all(entries.map(async entry => {
      const key = entry.utxo.txid
      if (messages.value.has(key)) return
      loadingMessages.value.add(key)
      try {
        messages.value.set(key, await fetchDonationMessageText(key))
      } catch {
        messages.value.set(key, null)
      } finally {
        loadingMessages.value.delete(key)
      }
    }))
  }

  async function init(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      allEntries.value = await fetchDonationMessageEntries()
      visibleCount.value = 0
      await loadMore()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadMore(batchSize = BATCH_SIZE): Promise<void> {
    const start = visibleCount.value
    const end = Math.min(start + batchSize, allEntries.value.length)
    if (end <= start) return
    visibleCount.value = end
    await resolveMessages(allEntries.value.slice(start, end))
  }

  return {
    allEntries,
    visibleEntries,
    hasMore,
    loading,
    error,
    messages,
    loadingMessages,
    init,
    loadMore,
  }
}

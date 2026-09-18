import { onMounted, onUnmounted } from 'vue'
import { useContractStore } from '@/stores/contract'

// Triggers contractStore.refresh() on view mount or tab focus regain, on top of App.vue's
// fixed refreshHot/refreshCold schedule.
const MIN_INTERVAL_MS = 15_000
let lastRefreshAt = 0

// Called by App.vue's initial refresh() to record the timestamp, so the throttle below
// doesn't immediately allow a second refresh.
export function markContractStoreRefreshed(): void {
  lastRefreshAt = Date.now()
}

async function throttledRefresh(contractStore: ReturnType<typeof useContractStore>): Promise<void> {
  const now = Date.now()
  if (now - lastRefreshAt < MIN_INTERVAL_MS) return
  lastRefreshAt = now
  await contractStore.refresh()
}

/**
 * Call from views that display contractStore (NFT-related) data; skip it in views that
 * don't need that data.
 */
export function useLiveRefresh(): void {
  const contractStore = useContractStore()

  onMounted(() => {
    throttledRefresh(contractStore)
  })

  function handleVisibility(): void {
    if (document.visibilityState === 'visible') {
      throttledRefresh(contractStore)
    }
  }
  document.addEventListener('visibilitychange', handleVisibility)
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibility)
  })
}

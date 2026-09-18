import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Live-ticking wall-clock time (unix seconds), independent of chainMtp which only
 * updates when contractStore polls the chain.
 */
export function useLiveClock() {
  const now = ref(Math.floor(Date.now() / 1000))
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    timer = setInterval(() => { now.value = Math.floor(Date.now() / 1000) }, 1000)
  })
  onUnmounted(() => { if (timer) clearInterval(timer) })

  return { now }
}

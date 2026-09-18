import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** Live day/hour/minute/second countdown to a target Unix-epoch-seconds timestamp, clamped at zero. */
export function useCountdown(target: Ref<bigint>) {
  const now = ref(Math.floor(Date.now() / 1000))
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    timer = setInterval(() => { now.value = Math.floor(Date.now() / 1000) }, 1000)
  })
  onUnmounted(() => { if (timer) clearInterval(timer) })

  const remaining = computed(() => Math.max(0, Number(target.value) - now.value))
  const days = computed(() => Math.floor(remaining.value / 86400))
  const hours = computed(() => Math.floor((remaining.value % 86400) / 3600))
  const minutes = computed(() => Math.floor((remaining.value % 3600) / 60))
  const seconds = computed(() => remaining.value % 60)

  const display = computed(() => `${pad(hours.value)}:${pad(minutes.value)}:${pad(seconds.value)}`)

  return { display, days, hours, minutes, seconds, remaining }
}

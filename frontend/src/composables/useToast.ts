import { ref } from 'vue'

export type ToastType = 'info' | 'success' | 'error' | 'warning'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

// Global singleton state shared across all useToast() calls
const toasts = ref<ToastItem[]>([])
let nextId = 0

// warning/error stay longer than info/success
const DEFAULT_DURATION_MS: Record<ToastType, number> = {
  info: 3500,
  success: 4000,
  warning: 5000,
  error: 5500,
}

export function useToast() {
  function showToast(message: string, type: ToastType = 'info', durationMs?: number): void {
    const id = nextId++
    toasts.value.push({ id, message, type })
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id)
    }, durationMs ?? DEFAULT_DURATION_MS[type])
  }

  function removeToast(id: number): void {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return { toasts, showToast, removeToast }
}

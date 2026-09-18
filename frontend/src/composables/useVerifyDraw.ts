/**
 * useVerifyDraw.ts — draw evidence-trail lookup (for the fairness-verification page).
 *
 * Returns the txid of each step in settle → aggregate → enterDrawingPhase → draw, for the
 * player to check on a Bitcoin Cash explorer themselves. See fetchDrawTrail().
 */
import { ref } from 'vue'
import { fetchDrawTrail, type DrawTrail } from '@/lib/electrum'

export function useVerifyDraw() {
  const loading = ref(false)
  const result = ref<DrawTrail | null>(null)
  const error = ref<string | null>(null)

  async function verify(round: number): Promise<void> {
    loading.value = true
    error.value = null
    result.value = null
    try {
      result.value = await fetchDrawTrail(round)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  return { loading, result, error, verify }
}

/**
 * pendingSignature.ts — durable "what should exist on-chain if this succeeded" record,
 * persisted to localStorage before ever asking the wallet to sign.
 *
 * The in-session SignatureConnectionLostError → pollForCommitment() path (see composables)
 * only works if the tab's JS execution survives long enough to reach its own catch block.
 * Mobile OSes routinely discard a backgrounded tab entirely rather than pausing it — when the
 * player switches back, the browser just reloads the URL fresh, and every in-memory Promise/
 * module-level variable from before is gone. localStorage is the only thing that survives that.
 * Reconciling against it needs nothing from the wallet or the OS — only the address/category/
 * commitment already computed before the signature request, and a plain chain read.
 */
import { i18n } from '@/i18n'
import { pollForNewCommitment } from '@/lib/broadcastRetry'
import { useToast } from '@/composables/useToast'
import { useTicketStore } from '@/stores/ticket'

export interface PendingSignatureRecord {
  address: string
  category: string
  commitment: string
  /** `${txid}:${vout}` 集合——送出簽名前，這個地址上已經符合 commitment 的既有 UTXO。
   *  同參數重複操作（例如玩家重複買同一組號碼）會產生 byte-for-byte 相同的 commitment，
   *  查證時要靠這份「之前就有」的名單，才能分辨查到的是舊的還是這次新增的。 */
  beforeKeys: string[]
  createdAt: number
}

const STORAGE_KEY = 'pendingSignature'

export function savePendingSignature(record: PendingSignatureRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
}

export function clearPendingSignature(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function loadPendingSignature(): PendingSignatureRecord | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingSignatureRecord
  } catch {
    return null
  }
}

/**
 * Call unconditionally on app startup — completely independent of wallet connection state,
 * since the record already carries the address to check. Resolves whatever operation was left
 * pending (from any tab lifecycle outcome: reload, force-close, days-later reopen) by reading
 * the chain, then clears the record either way.
 */
export async function reconcilePendingSignature(): Promise<void> {
  const record = loadPendingSignature()
  if (!record) return

  const { showToast } = useToast()
  const found = await pollForNewCommitment(record.address, record.category, record.commitment, record.beforeKeys)
  clearPendingSignature()

  if (found) {
    showToast(i18n.global.t('errors.wallet_result_recovered_success'), 'success')
    await useTicketStore().fetchForAddress(record.address)
  } else {
    showToast(i18n.global.t('errors.wallet_result_recovered_unknown'), 'warning')
  }
}

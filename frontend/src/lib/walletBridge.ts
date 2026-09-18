/**
 * walletBridge.ts — thin wrapper around walletconnect.ts used by composables.
 *
 * Exists so composables call a stable API here rather than importing walletconnect.ts
 * directly, and so the shared error classes have one obvious re-export point.
 */

import type { TransactionBuilder } from 'cashscript'
import type { WcSourceOutput } from '@bch-wc2/interfaces'
import * as officialWalletConnect from '@/lib/walletconnect'
import { useWalletStore } from '@/stores/wallet'
import { NotConnectedError } from '@/lib/walletErrors'
import type { Utxo } from '@/types'

export { NotConnectedError, UserRejectedError, BroadcastError, SignatureConnectionLostError } from '@/lib/walletErrors'

/**
 * A player-owned UTXO plus the address it actually lives at. Official WalletConnect exposes a
 * single connected address, so every utxo lives at that same `address`; `pathName`/`addressIndex`
 * are unused placeholders kept only so callers building `inputPaths` entries don't need a
 * provider-specific shape.
 */
export interface PlayerUtxo {
  utxo: Utxo
  address: string
  pathName: string
  addressIndex: number
}

export async function fetchPlayerUtxos(): Promise<PlayerUtxo[]> {
  const store = useWalletStore()
  if (store.provider === 'walletconnect') {
    if (!store.address) throw new NotConnectedError()
    const utxos = await officialWalletConnect.fetchPlayerUtxos(store.address)
    return utxos.map(utxo => ({ utxo, address: store.address!, pathName: 'receive', addressIndex: 0 }))
  }
  throw new NotConnectedError()
}

/**
 * Signs `txBuilder`'s current state via official WalletConnect. `txHex`/`sourceOutputs`/
 * `inputPaths` are unused here — official WalletConnect derives everything it needs directly
 * from `txBuilder` via `generateWcTransactionObject()` — but kept in the signature so callers
 * built around the shared source-output/input-path construction don't need a special case.
 * `action` is a plain-language description of what this transaction does (e.g. "購買 8 張彩票"),
 * shown to the player as the wallet's confirmation prompt.
 */
export async function requestSignature(
  txBuilder: TransactionBuilder,
  _txHex: string,
  _sourceOutputs: WcSourceOutput[],
  _inputPaths: [number, string, number][],
  action: string,
): Promise<string> {
  const store = useWalletStore()
  if (store.provider === 'walletconnect') {
    return officialWalletConnect.requestSignature(txBuilder, action)
  }
  throw new NotConnectedError()
}

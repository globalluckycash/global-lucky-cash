import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import * as officialWalletConnect from '@/lib/walletconnect'
import type { WalletConnectionStatus } from '@/types'

export type WalletProvider = 'walletconnect' | null

export const useWalletStore = defineStore('wallet', () => {
  const status = ref<WalletConnectionStatus>('disconnected')
  const provider = ref<WalletProvider>(null)
  const walletName = ref<string | null>(null)
  const address = ref<string | null>(null)

  const isConnected = computed(() => status.value === 'connected')
  // Legacy alias used by composables
  const isWalletConnected = isConnected

  // `address` is always stored token-aware (see officialWalletConnect.parseAddress) since that's
  // what tx building needs; the wallet info modal additionally shows the plain cash address.
  const cashAddress = computed(() => address.value ? officialWalletConnect.toPlainAddress(address.value) : null)

  function init(): void {
    officialWalletConnect.initWalletConnect().then(({ resumed }) => {
      if (!resumed) return
      const addr = officialWalletConnect.getResumedAddress()
      if (!addr) return
      provider.value = 'walletconnect'
      address.value = addr
      status.value = 'connected'
    }).catch((err) => {
      console.error('[WalletConnect] init failed:', err)
    })
  }

  async function connectWalletConnect(): Promise<void> {
    provider.value = 'walletconnect'
    status.value = 'connecting'
    try {
      const addr = await officialWalletConnect.startConnection()
      address.value = addr
      status.value = 'connected'
    } catch (err) {
      provider.value = null
      status.value = 'disconnected'
      throw err
    }
  }

  async function disconnectWallet(): Promise<void> {
    await officialWalletConnect.disconnect()
    provider.value = null
    status.value = 'disconnected'
    address.value = null
    walletName.value = null
  }

  /** Legacy: restore session on app mount */
  async function restoreSession(): Promise<void> {
    init()
  }

  return {
    status,
    provider,
    walletName,
    address,
    cashAddress,
    isConnected,
    isWalletConnected,
    init,
    connectWalletConnect,
    disconnect: disconnectWallet,
    restoreSession,
  }
})

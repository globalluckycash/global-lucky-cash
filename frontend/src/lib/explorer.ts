import { ref, watch } from 'vue'

const network = import.meta.env.VITE_NETWORK as string

export interface ExplorerProvider {
  name: string
  txUrl(txid: string): string
  addressUrl(address: string): string
}

const MAINNET_PROVIDERS: ExplorerProvider[] = [
  {
    name: 'bchexplorer.info',
    txUrl: (txid) => `https://bchexplorer.info/tx/${txid}`,
    addressUrl: (address) => `https://bchexplorer.info/address/${address}`,
  },
  {
    name: 'bchexplorer.cash',
    txUrl: (txid) => `https://bchexplorer.cash/tx/${txid}`,
    addressUrl: (address) => `https://bchexplorer.cash/address/${address}`,
  },
]

const CHIPNET_PROVIDERS: ExplorerProvider[] = [
  {
    name: 'chipnet.bchexplorer.info',
    txUrl: (txid) => `https://chipnet.bchexplorer.info/tx/${txid}`,
    addressUrl: (address) => `https://chipnet.bchexplorer.info/address/${address}`,
  },
  {
    name: 'bchexplorer.cash',
    txUrl: (txid) => `https://bchexplorer.cash/chipnet/tx/${txid}`,
    addressUrl: (address) => `https://bchexplorer.cash/chipnet/address/${address}`,
  },
]

export function explorerProviders(): ExplorerProvider[] {
  return network === 'mainnet' ? MAINNET_PROVIDERS : CHIPNET_PROVIDERS
}

const STORAGE_KEY = 'explorer_provider_index'

function loadSelectedIndex(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const idx = raw !== null ? Number(raw) : 0
    return Number.isInteger(idx) && idx >= 0 && idx < explorerProviders().length ? idx : 0
  } catch {
    return 0
  }
}

export const selectedExplorerIndex = ref(loadSelectedIndex())

watch(selectedExplorerIndex, (idx) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(idx))
  } catch {
    // localStorage unavailable (e.g. private mode) — selection just won't persist across reloads
  }
})

function currentProvider(): ExplorerProvider {
  const providers = explorerProviders()
  return providers[selectedExplorerIndex.value] ?? providers[0]
}

export function explorerTxUrl(txid: string): string {
  return currentProvider().txUrl(txid)
}

export function explorerAddressUrl(address: string): string {
  return currentProvider().addressUrl(address)
}

/** 固定使用 bchexplorer.cash（不受使用者選擇的總管切換影響），供 NFT 顯示較友善的頁面使用。 */
export function bchExplorerCashTxUrl(txid: string): string {
  const providers = network === 'mainnet' ? MAINNET_PROVIDERS : CHIPNET_PROVIDERS
  const provider = providers.find((p) => p.name === 'bchexplorer.cash') ?? providers[0]
  return provider.txUrl(txid)
}

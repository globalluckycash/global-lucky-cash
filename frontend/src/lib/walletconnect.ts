/**
 * walletconnect.ts — official WalletConnect (wc2-bch-bcr) integration, for wallets
 * implementing the standard BCH WalletConnect spec
 * (https://github.com/mainnet-pat/wc2-bch-bcr), e.g. Cashonize, Selene, Zapit.
 *
 * Talks to wallets over the official WalletConnect relay using a single connected address,
 * and defers all `sourceOutputs`/contract-metadata construction to cashscript's
 * `TransactionBuilder.generateWcTransactionObject()`.
 */

import SignClient from '@walletconnect/sign-client'
import { WalletConnectModal } from '@walletconnect/modal'
import { stringify, decodeCashAddress, encodeCashAddress } from '@bitauth/libauth'
import type { TransactionBuilder, WcTransactionObject } from 'cashscript'
import { getAddressUtxos } from '@/lib/electrum'
import { NotConnectedError, UserRejectedError, SignatureConnectionLostError } from '@/lib/walletErrors'
import { i18n } from '@/i18n'
import type { Utxo } from '@/types'

// WalletConnect SDK 標準錯誤碼（見 @walletconnect/utils SDK_ERRORS.USER_REJECTED），
// 用來判斷 _client.request() 的 reject 是玩家在錢包端真的按了拒絕，還是其他原因
// （relay 斷線、逾時等）——後者不該被當成使用者拒絕。
const WC_USER_REJECTED_CODE = 5000

const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
const NETWORK = (import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'chipnet') as 'mainnet' | 'chipnet'
const CONNECTED_CHAIN = NETWORK === 'mainnet' ? 'bch:bitcoincash' : 'bch:bchtest'

const REQUIRED_NAMESPACES = {
  bch: {
    chains: [CONNECTED_CHAIN],
    methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage'],
    events: ['addressesChanged'],
  },
}

const METADATA = {
  name: 'Global Lucky Cash',
  description: 'Bitcoin Cash smart-contract lottery',
  url: window.location.origin,
  icons: [`${window.location.origin}/logo.png`],
}

let _client: SignClient | undefined
let _modal: WalletConnectModal | undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _session: any
let _initPromise: Promise<{ resumed: boolean }> | undefined

// 手機在簽名等待期間切去錢包 App 再切回來時，分頁會被系統背景化，底層 relay 連線可能
// 中斷又重連，導致錢包端已處理完成的回應訊息遺失（requestSignature() 的 Promise 永久
// 卡住）。這裡追蹤「頁面最近一次從隱藏變回可見」的時間，讓 requestSignature() 在偵測到
// 這個情況發生過後縮短逾時等待，而不是傻等固定的長逾時。
let _lastVisibleAt: number | null = null
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _lastVisibleAt = Date.now()
})

function getModal(): WalletConnectModal {
  if (!_modal) {
    _modal = new WalletConnectModal({ projectId: PROJECT_ID, themeMode: 'dark' })
  }
  return _modal
}

/**
 * Converts a wallet-reported address to its token-aware CashAddress encoding (p2pkh → p2pkhWithTokens,
 * p2sh → p2shWithTokens). Connected WalletConnect wallets report whichever encoding they use
 * internally — often a plain "q"-prefixed address, since not every BCH wallet's UX distinguishes
 * token vs. non-token addresses — but this app builds NFT/CashToken outputs (e.g. TicketNFT) `to`
 * that address, and cashscript's `addOutput()` throws `TokensToNonTokenAddressError` ("Tried to
 * send tokens to an address without token support") if it doesn't decode as token-aware. The
 * underlying locking script (and thus ownership/spendability) is identical either way — only the
 * cashaddr's type bit changes — so this is a safe no-op for already-token-aware addresses.
 * Mirrors `scripts/mintNft.ts`'s `toTokenAddress()`.
 */
function toTokenAddress(address: string): string {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === 'string') throw new Error(`Invalid address from wallet: ${address}`)
  if (decoded.type === 'p2pkhWithTokens' || decoded.type === 'p2shWithTokens') return address
  const tokenType = decoded.type === 'p2pkh' ? 'p2pkhWithTokens'
    : decoded.type === 'p2sh' ? 'p2shWithTokens'
    : null
  if (!tokenType) throw new Error(`Unsupported address type from wallet: ${decoded.type}`)
  return encodeCashAddress({ prefix: decoded.prefix, type: tokenType, payload: decoded.payload, throwErrors: true }).address
}

/**
 * Converts a token-aware CashAddress (p2pkhWithTokens/p2shWithTokens) back to its plain encoding
 * (p2pkh/p2sh) — the inverse of toTokenAddress(). `walletStore.address` is always stored
 * token-aware (see parseAddress() below), but the wallet info modal shows the player both the
 * plain "cash address" and the token-aware "token address" so they can pick whichever their
 * receiving wallet/exchange expects. Safe no-op for already-plain addresses.
 */
export function toPlainAddress(address: string): string {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === 'string') throw new Error(`Invalid address: ${address}`)
  if (decoded.type === 'p2pkh' || decoded.type === 'p2sh') return address
  const plainType = decoded.type === 'p2pkhWithTokens' ? 'p2pkh'
    : decoded.type === 'p2shWithTokens' ? 'p2sh'
    : null
  if (!plainType) throw new Error(`Unsupported address type: ${decoded.type}`)
  return encodeCashAddress({ prefix: decoded.prefix, type: plainType, payload: decoded.payload, throwErrors: true }).address
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAddress(session: any): string | null {
  const account = session?.namespaces?.bch?.accounts?.[0]
  if (!account) return null
  // CAIP-10 account id is "bch:<chain>:<cashaddress>" — the cashaddress itself already
  // contains a ':', so only the leading "bch" namespace segment is stripped.
  const address = account.split(':').slice(1).join(':')
  return toTokenAddress(address)
}

/**
 * Initializes the SignClient (memoized — concurrent/repeat calls share one in-flight init
 * rather than racing to create separate clients) and checks local storage for a
 * previously-approved session so it can be resumed without a fresh QR scan. Does not itself
 * flip any wallet-store state — the caller decides whether to apply the resumed session (e.g.
 * only if no other provider is already active/connected).
 */
export function initWalletConnect(): Promise<{ resumed: boolean }> {
  if (!_initPromise) {
    _initPromise = SignClient.init({ projectId: PROJECT_ID, metadata: METADATA }).then((client) => {
      _client = client
      const sessions = client.session.getAll()
      const last = sessions[sessions.length - 1]
      if (last) {
        _session = last
        return { resumed: true }
      }
      return { resumed: false }
    })
  }
  return _initPromise
}

export function getResumedAddress(): string | null {
  return parseAddress(_session)
}

/**
 * Opens the official WalletConnect modal (its own QR/deep-link UI) and waits for wallet
 * approval. Resolves with the connected BCH address once approved.
 */
export async function startConnection(): Promise<string> {
  if (!_client) await initWalletConnect()
  if (!_client) throw new Error('WalletConnect client not initialized')
  const { uri, approval } = await _client.connect({ requiredNamespaces: REQUIRED_NAMESPACES })
  if (!uri) throw new Error('WalletConnect connect() returned no pairing URI')
  const modal = getModal()
  await modal.openModal({ uri })

  // approval() 只會在錢包端核准/拒絕 pairing proposal 時才 settle；使用者單純把 QR
  // 彈窗關掉並不會觸發它，會讓這個 promise 永遠掛著、連帶讓呼叫端的 connecting 狀態卡死。
  // 這裡用 subscribeModal 監聽彈窗被關閉的事件，搭配 Promise.race 主動 reject。
  const approvalPromise = approval()
  approvalPromise.catch(() => {}) // 避免使用者取消後，proposal 過期才 reject 時跳出未處理的 rejection 警告
  let settled = false
  let unsubscribe: () => void = () => {}
  const modalClosed = new Promise<never>((_, reject) => {
    unsubscribe = modal.subscribeModal((state: { open: boolean }) => {
      if (!state.open && !settled) reject(new UserRejectedError(i18n.global.t('toast.connect_cancelled')))
    })
  })

  try {
    const session = await Promise.race([approvalPromise, modalClosed])
    settled = true
    _session = session
    const address = parseAddress(session)
    if (!address) throw new Error('Connected wallet returned no BCH address')
    return address
  } finally {
    settled = true
    unsubscribe()
    modal.closeModal()
  }
}

export function getPlayerAddress(): string | null {
  return parseAddress(_session)
}

/**
 * Official WalletConnect exposes a single active address (no HD multi-path scanning), so
 * every UTXO returned here belongs to `address`.
 */
export async function fetchPlayerUtxos(address: string): Promise<Utxo[]> {
  return (await getAddressUtxos(address)).filter(u => !u.token)
}

/**
 * Wraps `action` (a plain-language description of what this transaction does, e.g. "購買 8 張
 * 彩票", supplied by the calling composable) into the BCH WalletConnect `userPrompt` shown to the
 * player during signature approval. A full input/output breakdown isn't shown here — most wallets
 * already render their own transaction detail view, so this prompt's job is just to tell the
 * player what operation they're approving, not to duplicate that detail.
 */
function buildUserPrompt(action: string): string {
  return i18n.global.t('wallet_action.prompt_template', { action })
}

/**
 * cashscript 的 `generateWcTransactionObject()` 會替每一個「用合約解鎖」的 input，在
 * `sourceOutputs[].contract.artifact` 塞進**完整**的編譯 artifact——包含 `source`（整份 .cash
 * 原始碼文字）、`debug`（sourcemap／logs／requires）、以及 `bytecode`（跟同物件裡已經有的
 * `redeemScript` 重複的 hex 版本）。RoundShardAuth 這樣一份約 34KB、RoundSwitchControl 約
 * 102KB，而且**每個 input 各塞一份，完全不去重**。換輪批次裡只要 RSA shard input 一多，
 * payload 就會膨脹到 MB 等級，WalletConnect relay 會默默送不出去（"Failed to publish
 * payload, please try again"）——relay 設計上是給小型的信令訊息用的，不是拿來塞 MB 級的資料。
 * cashscript 的型別本身寫的是 `artifact: Partial<Artifact>`（型別上就暗示這裡該放精簡版），
 * 只是 0.13.1 版的 runtime 沒有真的做這個精簡。這裡把 `bytecode`／`source`／`debug` 拿掉
 * （保留 contractName、constructorInputs、abi、compiler 等），可以讓每個 input 的負擔砍掉
 * ~98%，同時錢包可能會顯示的欄位都還在；真正簽名/驗證解鎖腳本需要的 `abiFunction`／
 * `redeemScript` 完全不動。
 *
 * **不能直接在原物件上 `delete` 欄位**：`Contract` instance 持有的是原始 artifact 物件的
 * 參照（不是複製），同一份 artifact 會被全部 64 個 RSA shard 合約實例、以及每一個
 * RoundSwitchControl 實例共用。如果直接刪掉共用物件上的欄位，之後任何一次
 * `new Contract(...)` 都會因為缺少必要欄位而拋出 `"Invalid or incomplete artifact
 * provided"`，整個頁面 session 剩下的時間都會壞掉。因此這裡改成幫每個 sourceOutput 各自
 * 淺複製一份精簡過的 artifact，不動到原本共用的物件。
 */
function stripHeavyArtifactFields(wcTransactionObj: WcTransactionObject): void {
  for (const sourceOutput of wcTransactionObj.sourceOutputs) {
    if (!sourceOutput.contract) continue
    const { bytecode: _bytecode, source: _source, debug: _debug, ...trimmedArtifact } = sourceOutput.contract.artifact
    sourceOutput.contract = { ...sourceOutput.contract, artifact: trimmedArtifact }
  }
}

class SignatureTimeoutSignal extends Error {}

/**
 * `_client.request()` 沒有內建 timeout：手機切去錢包 App 簽名、再切回瀏覽器時，分頁
 * 被系統背景化造成 relay 連線中斷又重連，錢包端已處理完成的回應訊息可能因此遺失，讓
 * 這個 Promise 永久卡住（已透過實機重現＋鏈上 txid 核對確認）。這裡用固定的 90 秒逾時
 * 保底；若等待期間偵測到「頁面曾經隱藏又恢復可見」（即切 App 又切回來的確切場景），
 * 恢復可見後縮短成 15 秒寬限期——不用真的等到 90 秒，讓呼叫端更快進入查證流程。
 */
function raceWithSignatureTimeout<T>(promise: Promise<T>): Promise<T> {
  const startedAt = Date.now()
  const BACKSTOP_MS = 90_000
  const GRACE_MS = 15_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    const check = () => {
      const deadline = _lastVisibleAt !== null && _lastVisibleAt > startedAt
        ? Math.min(startedAt + BACKSTOP_MS, _lastVisibleAt + GRACE_MS)
        : startedAt + BACKSTOP_MS
      const remaining = deadline - Date.now()
      if (remaining <= 0) { reject(new SignatureTimeoutSignal()); return }
      timer = setTimeout(check, Math.min(remaining, 5000))
    }
    check()
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

/**
 * Signs `txBuilder`'s current state via the official BCH WalletConnect `bch_signTransaction`
 * method. Source outputs and contract metadata are derived automatically from the builder's
 * own inputs (see cashscript's `generateWcTransactionObject`), so no manual
 * `sourceOutputs`/`inputPaths` construction is needed by callers. `action` is a plain-language
 * description of what this transaction does (e.g. "購買 8 張彩票"), shown to the player as the
 * wallet's `userPrompt` — see `buildUserPrompt()`.
 */
export async function requestSignature(txBuilder: TransactionBuilder, action: string): Promise<string> {
  if (!_client || !_session) throw new NotConnectedError()
  const wcTransactionObj = txBuilder.generateWcTransactionObject({
    broadcast: false,
    userPrompt: buildUserPrompt(action),
  })
  stripHeavyArtifactFields(wcTransactionObj)
  try {
    const result = await raceWithSignatureTimeout(_client.request({
      chainId: CONNECTED_CHAIN,
      topic: _session.topic,
      request: {
        method: 'bch_signTransaction',
        params: JSON.parse(stringify(wcTransactionObj)),
      },
    }))
    const signedTransaction = (result as { signedTransaction?: string } | undefined)?.signedTransaction
    if (!signedTransaction) throw new UserRejectedError()
    return signedTransaction
  } catch (err) {
    if (err instanceof UserRejectedError) throw err
    if (err instanceof SignatureTimeoutSignal) throw new SignatureConnectionLostError()
    // 玩家在錢包端真的按了拒絕：WalletConnect SDK 用標準錯誤碼回報（見 @walletconnect/utils
    // SDK_ERRORS.USER_REJECTED），其餘任何例外（relay 斷線、網路錯誤等）都不該被當成拒絕。
    const code = (err as { code?: number } | undefined)?.code
    if (code === WC_USER_REJECTED_CODE) throw new UserRejectedError()
    throw new SignatureConnectionLostError(err instanceof Error ? err.message : String(err))
  }
}

export async function disconnect(): Promise<void> {
  if (_client && _session) {
    try {
      await _client.disconnect({ topic: _session.topic, reason: { code: 0, message: 'User disconnected' } })
    } catch {
      // Best-effort courtesy notification only — local state is cleared below regardless.
    }
  }
  _session = undefined
}

/**
 * contractConfig.ts — Contract address initialization
 * Browser port of scripts/contractConfig.ts
 */

import { Contract, ElectrumNetworkProvider, TransactionBuilder, type NetworkProvider } from 'cashscript'
import { ElectrumClient, type RequestResponse } from '@electrum-cash/network'
import { ElectrumWebSocket } from '@electrum-cash/web-socket'
import { cashAddressToLockingBytecode, encodeCashAddress, sha256 } from '@bitauth/libauth'
import { hexReverse, binToHex, hexToBin, leHex } from './bytes'
import { buildRSACommitment, buildNSCommitment, buildTicketCommitment } from './nftDecode'
import { TICKET_PRICE_USD_CENTS } from './pricing'

import roundShardAuthArtifact    from '@artifacts/RoundShardAuth.json'
import ticketDepositArtifact      from '@artifacts/TicketDeposit.json'
import numberSalesArtifact        from '@artifacts/NumberSales.json'
import roundSwitchControlArtifact from '@artifacts/RoundSwitchControl.json'
import drawingArtifact            from '@artifacts/Drawing.json'
import platformPoolArtifact       from '@artifacts/PlatformPool.json'
import fixedPrizePoolArtifact     from '@artifacts/FixedPrizePool.json'
import jackpotPoolArtifact        from '@artifacts/JackpotPool.json'

const NETWORK = import.meta.env.VITE_NETWORK as 'mainnet' | 'chipnet'
const AUTH_NFT_CATEGORY_ID = import.meta.env.VITE_AUTH_NFT_CATEGORY_ID as string
const ADMIN_NFT_CATEGORY_ID = import.meta.env.VITE_ADMIN_NFT_CATEGORY_ID as string
const ORACLE_PUB = import.meta.env.VITE_ORACLE_PUB as string
const SHARD_COUNT = parseInt(import.meta.env.VITE_SHARD_COUNT ?? '64', 10)

export type FailoverElectrumProvider = NetworkProvider & {
  performRequest(name: string, ...parameters: (string | number | boolean)[]): Promise<RequestResponse>
}

// entry 是字串 → 公開節點，走 cashscript { hostname } 方便寫法（固定 wss://<host>:50004）。
// entry 是 config object → 本機自架節點（infra/chipnet-node/），純 loopback 不需要 TLS，
// 自組 ElectrumClient（@electrum-cash/network + @electrum-cash/web-socket）改連
// ws://<host>:<port>，比照 scripts/contractConfig.ts 的 buildElectrumProvider()。
type ElectrumHost = string | { host: string; port: number; encrypted: boolean }

// 各自獨立維運的 Fulcrum 節點池，任一台不穩定時依序輪替下一台——比照 scripts/contractConfig.ts
// 的 ELECTRUM_HOSTS。chipnet.bch.ninja／chipnet.imaginary.cash 經測試後不穩定，改用
// electrum-chipnet.optnlabs.com。
//
// 只在 `npm run dev`（import.meta.env.DEV）時把本機自架節點排第一優先——這台節點只給開發者
// 自己機器上的瀏覽器連得到（127.0.0.1），staging/production 建置給的是其他人的瀏覽器，
// 加進去也連不到，所以正式建置不排它。
const ELECTRUM_HOSTS: Record<'mainnet' | 'chipnet', ElectrumHost[]> = {
  mainnet: ['bch.imaginary.cash', 'bch.loping.net', 'fulcrum.criptolayer.net'],
  chipnet: [
    ...(import.meta.env.DEV ? [{ host: '127.0.0.1', port: 50004, encrypted: false }] : []),
    'chipnet.bch.ninja',
    'electrum-chipnet.optnlabs.com',
    'chipnet.imaginary.cash',
  ],
}

function buildElectrumProvider(
  network: 'mainnet' | 'chipnet',
  entry: ElectrumHost,
): ElectrumNetworkProvider {
  if (typeof entry === 'string') {
    return new ElectrumNetworkProvider(network, { hostname: entry, manualConnectionManagement: true })
  }
  const socket = new ElectrumWebSocket(entry.host, entry.port, entry.encrypted)
  const client = new ElectrumClient('CashScript Application', '1.4.1', socket)
  return new ElectrumNetworkProvider(network, { electrum: client, manualConnectionManagement: true })
}

/**
 * cashscript 預設的 ElectrumNetworkProvider 是「每次 request 各自 connect/disconnect」，這在
 * 呼叫端一次平行發出多個 request 時（例如 contract.ts 的 refresh() 用 Promise.all 平行打 9 個
 * 請求）會讓每個 request 各自搶著 connect() 同一個 host，彼此互相干擾、又踩上
 * @electrum-cash/network 另一個已知未修的 bug（confirmed unfixed thru
 * @electrum-cash/network@4.2.2 / @electrum-cash/web-socket@1.2.3）：非預期斷線後底層 socket
 * 參照要等內部重連計時器觸發才會被清除，這段空窗期會卡在 CONNECTING、對外只看得到
 * 「WebSocket is closed before the connection is established」之類看不出原因的錯誤，且背景那顆
 * 孤兒連線物件會無限重試、永遠印錯誤（實際踩到過）。同時，每輪操作間隔沒有重疊的請求時，
 * 預設模式還會在每一輪都重新走一次完整 connect handshake 再馬上斷線，是前台「感覺變慢」的
 * 主因之一。
 *
 * 這裡改成手動連線管理（manualConnectionManagement）＋只維持一條長連線，所有 request 共用：
 * - ensureConnected() 用一個共享的 connectPromise 讓「同時間的多個呼叫」等同一次 connect()，
 *   不會有人各自重複呼叫 connect()。呼叫端完全不用改，這一切都包在 withFailover 內部。
 * - 失敗時用 generation 計數器避免多個並行呼叫同時搶著 rebuild：只有第一個發現失敗的呼叫
 *   真的換下一台重建，其餘呼叫發現 generation 已經被別人推進過，直接放棄自己這次 rebuild，
 *   下一輪重試時就會讀到新的 real。
 * - 清單所有 host 都試過仍失敗，才把最後一次的錯誤原樣拋出。
 * 仿照 scripts/contractConfig.ts 的 createFailoverElectrumProvider()——同一個 bug、同一個對策。
 *
 * getConfig() 快取的 Contract 實例在建構時就綁死同一個 provider 物件參照，所以這裡回傳的必須是
 * 一個身份不變的 wrapper，內部持有的「真正」ElectrumNetworkProvider 才能被替換。
 */
function createResilientElectrumProvider(network: 'mainnet' | 'chipnet'): FailoverElectrumProvider {
  const hosts = ELECTRUM_HOSTS[network]
  let hostIndex = 0
  let generation = 0
  let real = buildElectrumProvider(network, hosts[hostIndex])
  let connectPromise: Promise<void> | null = null

  function ensureConnected(): Promise<void> {
    if (!connectPromise) {
      const target = real
      const p: Promise<void> = target.connect().catch((err) => {
        if (connectPromise === p) connectPromise = null
        throw err
      })
      connectPromise = p
    }
    return connectPromise
  }

  function rebuild(failedGeneration: number) {
    if (generation !== failedGeneration) return // 別的並行呼叫已經先 rebuild 過了
    generation++
    hostIndex = (hostIndex + 1) % hosts.length
    real = buildElectrumProvider(network, hosts[hostIndex])
    connectPromise = null
  }

  async function withFailover<T>(call: (p: ElectrumNetworkProvider) => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (let attempt = 0; attempt < hosts.length; attempt++) {
      const target = real
      const myGeneration = generation
      try {
        await ensureConnected()
        return await call(target)
      } catch (err) {
        lastErr = err
        rebuild(myGeneration)
      }
    }
    throw lastErr
  }

  return {
    network: real.network,
    getUtxos: address => withFailover(p => p.getUtxos(address)),
    getUtxosForLockingBytecode: lockingBytecode => withFailover(p => p.getUtxosForLockingBytecode(lockingBytecode)),
    getBlockHeight: () => withFailover(p => p.getBlockHeight()),
    getRawTransaction: txid => withFailover(p => p.getRawTransaction(txid)),
    sendRawTransaction: txHex => withFailover(p => p.sendRawTransaction(txHex)),
    performRequest: (name, ...parameters) => withFailover(p => p.performRequest(name, ...parameters)),
  }
}

export const provider = createResilientElectrumProvider(NETWORK)

function buildContracts() {
  const authIdLE = hexReverse(AUTH_NFT_CATEGORY_ID)
  const adminIdLE = hexReverse(ADMIN_NFT_CATEGORY_ID)

  const platformPoolContract   = new Contract(platformPoolArtifact, [authIdLE, adminIdLE], { provider })
  const fixedPrizePoolContract = new Contract(fixedPrizePoolArtifact, [authIdLE, adminIdLE, BigInt(TICKET_PRICE_USD_CENTS)], { provider })

  // JackpotPool 需要 FPP 與 PP 的 lockingBytecode 作為建構參數
  // （processExpired() 逾期重分配時直接以 plain BCH 匯入，不再透過各自的 pool NFT）
  const fppLBForJP = cashAddressToLockingBytecode(fixedPrizePoolContract.address)
  if (typeof fppLBForJP === 'string') throw new Error(`getLockingBytecode FPP: ${fppLBForJP}`)
  const ppLBForJP = cashAddressToLockingBytecode(platformPoolContract.address)
  if (typeof ppLBForJP === 'string') throw new Error(`getLockingBytecode PP: ${ppLBForJP}`)

  const jackpotPoolContract = new Contract(
    jackpotPoolArtifact,
    [authIdLE, fppLBForJP.bytecode, ppLBForJP.bytecode, adminIdLE, BigInt(TICKET_PRICE_USD_CENTS)],
    { provider }
  )

  const fppLB = cashAddressToLockingBytecode(fixedPrizePoolContract.address)
  if (typeof fppLB === 'string') throw new Error(`getLockingBytecode FPP: ${fppLB}`)
  const jpLB = cashAddressToLockingBytecode(jackpotPoolContract.address)
  if (typeof jpLB === 'string') throw new Error(`getLockingBytecode JP: ${jpLB}`)

  const drawingContract = new Contract(
    drawingArtifact,
    [authIdLE, ORACLE_PUB, fppLB.bytecode, jpLB.bytecode, adminIdLE, BigInt(TICKET_PRICE_USD_CENTS)],
    { provider }
  )

  // RoundSwitchControl 需要 drawingContract / platformPoolContract / fixedPrizePoolContract
  // 的 lockingBytecode 作為建構參數（enterDrawingPhase() 平台份額扣除 DrawingNFT 保留款後
  // 的餘額直接付給 platformPoolLockingBytecode）
  const drawingLB = cashAddressToLockingBytecode(drawingContract.address)
  if (typeof drawingLB === 'string') throw new Error(`getLockingBytecode Drawing: ${drawingLB}`)
  const platformLB = cashAddressToLockingBytecode(platformPoolContract.address)
  if (typeof platformLB === 'string') throw new Error(`getLockingBytecode PlatformPool: ${platformLB}`)
  const fixedPrizeLB = cashAddressToLockingBytecode(fixedPrizePoolContract.address)
  if (typeof fixedPrizeLB === 'string') throw new Error(`getLockingBytecode FixedPrizePool: ${fixedPrizeLB}`)

  const roundSwitchControlContract = new Contract(
    roundSwitchControlArtifact,
    [authIdLE, drawingLB.bytecode, platformLB.bytecode, fixedPrizeLB.bytecode, adminIdLE, BigInt(TICKET_PRICE_USD_CENTS)],
    { provider }
  )

  return {
    authNftCategoryId: AUTH_NFT_CATEGORY_ID,
    adminNftCategoryId: ADMIN_NFT_CATEGORY_ID,
    shardCount: SHARD_COUNT,
    oraclePubKey: ORACLE_PUB,
    ticketPriceCents: TICKET_PRICE_USD_CENTS,
    roundSwitchControlContract,
    drawingContract,
    platformPoolContract,
    fixedPrizePoolContract,
    jackpotPoolContract,
  }
}

/**
 * 號碼銷售：79,360 組號碼各自獨立合約地址，依 lotteryNumber 建構參數（格式與 commitment [1-4] 一致，
 * 8 hex chars，見 buildLotteryNumber()）編譯出對應實例。
 */
export function getNumberSalesContract(lotteryNumber: string): Contract {
  const authIdLE = hexReverse(AUTH_NFT_CATEGORY_ID)
  const adminIdLE = hexReverse(ADMIN_NFT_CATEGORY_ID)
  return new Contract(numberSalesArtifact, [authIdLE, adminIdLE, lotteryNumber], { provider })
}

/**
 * 輪次分片：shardCount 個分片各自獨立合約地址，依 shardId 建構參數（格式與 commitment 分片編號
 * 欄位一致，LE uint16，4 hex chars，見 leHex()）編譯出對應實例。
 */
export function getRoundShardAuthContract(shardId: string): Contract {
  const authIdLE = hexReverse(AUTH_NFT_CATEGORY_ID)
  const adminIdLE = hexReverse(ADMIN_NFT_CATEGORY_ID)
  return new Contract(roundShardAuthArtifact, [authIdLE, adminIdLE, shardId, BigInt(TICKET_PRICE_USD_CENTS)], { provider })
}

// Lazy-initialized singleton — only built once on first access
let _config: ReturnType<typeof buildContracts> | null = null

export function getConfig() {
  if (!_config) _config = buildContracts()
  return _config
}

// Contract keys usable with getContractSourceUrl(). The first 3 are keyed the same way as
// verify.contracts_list in the i18n files — used by the /verify page to link to each fund
// pool's source (the pools also holding the claimJackpot()/claimFixedPrize() unlock functions
// players use to claim prizes). RoundShardAuth isn't in that i18n list — it's used directly by
// ShardContractCard.vue for the /verify page's 64-shard address/balance picker.
export const CONTRACT_KEYS = ['FixedPrizePool', 'JackpotPool', 'PlatformPool', 'RoundShardAuth'] as const

export type ContractKey = typeof CONTRACT_KEYS[number]

const GITHUB_REPO_BASE = 'https://github.com/globalluckycash/global-lucky-cash/blob/main'

export function getContractSourceUrl(key: ContractKey): string {
  return `${GITHUB_REPO_BASE}/contracts/${key}.cash`
}

// Takes a frontend/src/composables/*.ts filename (e.g. "useDraw.ts") — the actual composable
// that builds and submits the transaction for a given operation in the deployed frontend. This
// is the real "SDK" a player's click runs (the standalone scripts/ folder is a separate,
// unreleased CLI tool and is no longer kept in sync). Used for the per-operation source links
// next to each action (e.g. DrawProcessView's TriggerCard icons).
export function getComposableSourceUrl(fileName: string): string {
  return `${GITHUB_REPO_BASE}/frontend/src/composables/${fileName}`
}

// The composables/ folder itself — linked from verify.contracts_other_flows_note for operations
// that don't (yet) have their own per-action source link.
export function getComposablesFolderUrl(): string {
  return 'https://github.com/globalluckycash/global-lucky-cash/tree/main/frontend/src/composables'
}

export function getLockingBytecodeHex(address: string): string {
  const result = cashAddressToLockingBytecode(address)
  if (typeof result === 'string') throw new Error(`getLockingBytecodeHex: ${result}`)
  return binToHex(result.bytecode)
}

/**
 * Build the TicketDeposit preimage: round (LE, 2 bytes) + N × lotteryNumber (4 bytes each).
 * The contract stores only sha256(preimage) as a constructor parameter (fixed 32 bytes
 * regardless of N). buyTicket() itself takes no arguments — at spend time the contract
 * reconstructs this same preimage on-chain from tx.inputs[0] (RSA round) and
 * tx.inputs[1..N] (NumberSalesNFT lotteryNumber), so the NS inputs must be ordered to match
 * this function's `lotteryNumbers` array exactly, and `round` must match the RSA input's
 * actual round at spend time (else the sha256 check fails).
 */
export function buildTicketDepositPreimage(round: number, lotteryNumbers: string[]): Uint8Array {
  return hexToBin(leHex(round, 2) + lotteryNumbers.join(''))
}

/**
 * Create a TicketDeposit contract instance for a specific (round, lotteryNumbers, buyerPkh)
 * combination. The contract address is deterministic — same parameters always yield the same
 * address.
 */
export function createTicketDepositContract(
  round: number,
  lotteryNumbers: string[],  // each 8 hex chars (4 bytes: n1 n2 n3 s), 1..10 entries
  buyerPkh: Uint8Array,      // 20-byte P2PKH hash from the buyer's z-address
): Contract {
  const authIdLE = hexReverse(AUTH_NFT_CATEGORY_ID)
  const adminIdLE = hexReverse(ADMIN_NFT_CATEGORY_ID)
  const sha256LotteryNumbers = sha256.hash(buildTicketDepositPreimage(round, lotteryNumbers))
  return new Contract(
    ticketDepositArtifact,
    [authIdLE, sha256LotteryNumbers, buyerPkh, adminIdLE],
    { provider },
  )
}

/**
 * Re-encode a 20-byte P2PKH hash back into a token-enabled (z-prefix) cash address — the
 * inverse of decodeCashAddress's `.payload`. Used to rebuild a buyer's receiving address from
 * a URL-recovered order, which only carries the raw PKH (see depositRecoveryUrl.ts).
 */
export function pkhToTokenAddress(pkh: Uint8Array): string {
  return encodeCashAddress({
    prefix: NETWORK === 'mainnet' ? 'bitcoincash' : 'bchtest',
    type: 'p2pkhWithTokens',
    payload: pkh,
    throwErrors: true,
  }).address
}

/**
 * Estimate the exact miner fee (sats, at `feeRate` sats/byte) for a buyTicket-via-deposit
 * transaction buying `ticketQuantity` numbers, by building a dummy transaction of the identical
 * shape (RSA + NS×N + TicketDeposit covenant inputs; RSA + NS×N + Ticket×N + change outputs) and
 * measuring its real encoded byte size. Every field that affects this tx's byte size (redeem
 * script bytecode, NFT commitment lengths, P2PKH address lengths) is fixed-width regardless of
 * the actual UTXO/commitment values, so a dummy transaction's size exactly matches what a real
 * buyTicket() tx of the same N will broadcast as — no live network access needed. Used to size
 * `computeDepositInfo()`'s deposit-amount quote; a flat guessed constant here previously
 * undershot the real fee for larger N and forced a second deposit round-trip.
 */
export function estimateBuyTicketFeeSats(ticketQuantity: number, feeRate = 1): bigint {
  const dummyPkh = new Uint8Array(20)
  const dummyBuyerAddress = encodeCashAddress({
    prefix: NETWORK === 'mainnet' ? 'bitcoincash' : 'bchtest',
    type: 'p2pkhWithTokens',
    payload: dummyPkh,
    throwErrors: true,
  }).address
  const dummyLotteryNumbers = Array.from({ length: ticketQuantity }, () => '00000000')
  const depositContract = createTicketDepositContract(0, dummyLotteryNumbers, dummyPkh)
  // Byte size is identical regardless of which specific lotteryNumber/shardId is embedded
  // (fixed-width bytes4/bytes2 constants), so one representative dummy contract instance each
  // is enough for sizing.
  const dummyNsContract = getNumberSalesContract('00000000')
  const dummyRsaContract = getRoundShardAuthContract('0000')

  const txBuilder = new TransactionBuilder({ provider })
  txBuilder.addInput(
    {
      txid: '11'.repeat(32), vout: 0, satoshis: 100000n,
      token: {
        category: AUTH_NFT_CATEGORY_ID, amount: 0n,
        nft: { capability: 'minting', commitment: buildRSACommitment({ sellingRound: 0, shardId: 0, shardSalesCount: 0, exchangeRate: 30000, status: 0, lastSoldTime: 0n, gameOverFlag: 0 }) },
      },
    },
    dummyRsaContract.unlock.sellTicket(),
  )
  for (let i = 0; i < ticketQuantity; i++) {
    txBuilder.addInput(
      {
        txid: (i + 2).toString(16).padStart(2, '0').repeat(32).slice(0, 64), vout: 0, satoshis: 1000n,
        token: {
          category: AUTH_NFT_CATEGORY_ID, amount: 0n,
          nft: { capability: 'mutable', commitment: buildNSCommitment({ lotteryNumber: dummyLotteryNumbers[i], oddRound: 0, oddCount: 0, evenRound: 0, evenCount: 0 }) },
        },
      },
      dummyNsContract.unlock.sellTicket(),
    )
  }
  txBuilder.addInput(
    { txid: 'de'.repeat(32), vout: 0, satoshis: 100000000n },
    depositContract.unlock.buyTicket(),
  )

  txBuilder.addOutput({
    to: dummyRsaContract.tokenAddress,
    amount: 100000n,
    token: {
      category: AUTH_NFT_CATEGORY_ID, amount: 0n,
      nft: { capability: 'minting', commitment: buildRSACommitment({ sellingRound: 0, shardId: 0, shardSalesCount: ticketQuantity, exchangeRate: 30000, status: 0, lastSoldTime: 0n, gameOverFlag: 0 }) },
    },
  })
  for (let i = 0; i < ticketQuantity; i++) {
    txBuilder.addOutput({
      to: dummyNsContract.tokenAddress,
      amount: 1000n,
      token: {
        category: AUTH_NFT_CATEGORY_ID, amount: 0n,
        nft: { capability: 'mutable', commitment: buildNSCommitment({ lotteryNumber: dummyLotteryNumbers[i], oddRound: 0, oddCount: 1, evenRound: 0, evenCount: 0 }) },
      },
    })
  }
  for (let i = 0; i < ticketQuantity; i++) {
    txBuilder.addOutput({
      to: dummyBuyerAddress,
      amount: 1000n,
      token: {
        category: AUTH_NFT_CATEGORY_ID, amount: 0n,
        nft: { capability: 'none', commitment: buildTicketCommitment({ round: 0, n1: 1, n2: 1, n3: 1, s: 1, claimStatus: 0, purchaseRate: 30000 }) },
      },
    })
  }
  // Placeholder change output — byte size is independent of the amount value, so this measures
  // exactly what the real change output will cost regardless of its final sats value.
  txBuilder.addOutput({ to: dummyBuyerAddress, amount: 1000n })

  return BigInt(Math.ceil(feeRate * Number(txBuilder.getTransactionSize())))
}

/**
 * Estimate the exact miner fee (sats, at `feeRate` sats/byte) for a TicketDeposit.refund()
 * transaction: 1 covenant input (fixed-size unlock, no signature) + 1 plain P2PKH output.
 * Same dummy-transaction technique as estimateBuyTicketFeeSats() — every field affecting byte
 * size is fixed-width regardless of the actual values, so no live network access is needed.
 */
export function estimateRefundFeeSats(feeRate = 1): bigint {
  const dummyPkh = new Uint8Array(20)
  const dummyBuyerAddress = encodeCashAddress({
    prefix: NETWORK === 'mainnet' ? 'bitcoincash' : 'bchtest',
    type: 'p2pkhWithTokens',
    payload: dummyPkh,
    throwErrors: true,
  }).address
  const depositContract = createTicketDepositContract(0, ['00000000'], dummyPkh)

  const txBuilder = new TransactionBuilder({ provider })
  txBuilder.addInput(
    { txid: 'de'.repeat(32), vout: 0, satoshis: 100000000n },
    depositContract.unlock.refund(),
  )
  txBuilder.addOutput({ to: dummyBuyerAddress, amount: 1000n })

  return BigInt(Math.ceil(feeRate * Number(txBuilder.getTransactionSize())))
}

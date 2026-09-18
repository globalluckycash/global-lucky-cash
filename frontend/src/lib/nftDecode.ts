/**
 * nftDecode.ts — NFT Commitment parse/build utilities
 * Browser port of scripts/utils/commitments.ts (no Node.js Buffer / crypto)
 */

import { sha256, encodeDataPush } from '@bitauth/libauth'
import { beHex, leHex, leHexToBigInt, leHexToNumber, hexToBin, binToHex } from './bytes'

// ─── RoundShardAuthNFT — 23 bytes（結束遊戲規格書 4.5 新增 gameOverFlag）───
// [0]     purpose: 0x01
// [1-2]   sellingRound: LE uint16
// [3-4]   shardId: LE uint16
// [5-8]   shardSalesCount: LE uint32
// [9-12]  exchangeRate: LE uint32
// [13]    status: 0x00
// [14-21] lastSoldTime: LE int64 (8 bytes，「最後售出時間」棘輪欄位)
// [22]    gameOverFlag: 0x00 = 正常運作；0x01 = 已宣告結束（見結束遊戲規格書 4.5）

export interface RSANftState {
  sellingRound: number
  shardId: number
  shardSalesCount: number
  exchangeRate: number
  status: number
  lastSoldTime: bigint
  gameOverFlag: number
}

export function buildRSACommitment(s: RSANftState): string {
  return (
    '01' +
    leHex(s.sellingRound, 2) +
    leHex(s.shardId, 2) +
    leHex(s.shardSalesCount, 4) +
    leHex(s.exchangeRate, 4) +
    leHex(s.status, 1) +
    leHex(s.lastSoldTime, 8) +
    leHex(s.gameOverFlag, 1)
  )
}

export function parseRSACommitment(hex: string): RSANftState {
  return {
    sellingRound: leHexToNumber(hex.slice(2, 6)),
    shardId: leHexToNumber(hex.slice(6, 10)),
    shardSalesCount: leHexToNumber(hex.slice(10, 18)),
    exchangeRate: leHexToNumber(hex.slice(18, 26)),
    status: leHexToNumber(hex.slice(26, 28)),
    lastSoldTime: leHexToBigInt(hex.slice(28, 44)),
    gameOverFlag: leHexToNumber(hex.slice(44, 46)),
  }
}

// ─── ShardSettlementNFT（SS）— 31 bytes（結束遊戲規格書 4.4 新增 gameOverFlag）──────
// 與對應分片的 RoundShardAuthNFT 同地址，一片一份。phase 0x00（待結算）／0x01（待彙整）
// 決定「輪次」欄位代表 nextSellingRound 或 settlementRound。
// [0]     purpose: 0x09
// [1]     phase: 0x00 | 0x01
// [2-3]   round: LE uint16（待結算＝nextSellingRound；待彙整＝settlementRound）
// [4-5]   shardId: LE uint16
// [6-9]   nextSellingRate: LE uint32（待結算狀態＝下一輪要用的匯率；待彙整狀態＝thisNFTRate，
//         即本分片這一輪實際成交匯率，由 settle() 寫入，供 aggregate() 讀出寫進
//         ConfigNFT.settledRate，跟「待結算」意義不同）
// [10-17] sellingCutoffTime: LE int64 (8 bytes)
// [18-21] shardSalesCount: LE uint32
// [22-29] lastSoldTime: LE int64 (8 bytes，分片最後售出時間)
// [30]    gameOverFlag: 待結算狀態由 aggregate() 寫入（複製自 RSC）；待彙整狀態由 settle()
//         寫入（複製自被消費的 RSA，見結束遊戲規格書 4.4）

export interface SSNftState {
  phase: number
  round: number
  shardId: number
  nextSellingRate: number
  sellingCutoffTime: bigint
  shardSalesCount: number
  lastSoldTime: bigint
  gameOverFlag: number
}

export function buildSSCommitment(s: SSNftState): string {
  return (
    '09' +
    leHex(s.phase, 1) +
    leHex(s.round, 2) +
    leHex(s.shardId, 2) +
    leHex(s.nextSellingRate, 4) +
    leHex(s.sellingCutoffTime, 8) +
    leHex(s.shardSalesCount, 4) +
    leHex(s.lastSoldTime, 8) +
    leHex(s.gameOverFlag, 1)
  )
}

export function parseSSCommitment(hex: string): SSNftState {
  return {
    phase: leHexToNumber(hex.slice(2, 4)),
    round: leHexToNumber(hex.slice(4, 8)),
    shardId: leHexToNumber(hex.slice(8, 12)),
    nextSellingRate: leHexToNumber(hex.slice(12, 20)),
    sellingCutoffTime: leHexToBigInt(hex.slice(20, 36)),
    shardSalesCount: leHexToNumber(hex.slice(36, 44)),
    lastSoldTime: leHexToBigInt(hex.slice(44, 60)),
    gameOverFlag: leHexToNumber(hex.slice(60, 62)),
  }
}

// ─── NumberSalesNFT — 17 bytes ───────────────────────────────────────────────
// [0]    purpose: 0x02
// [1-4]  lotteryNumber: [n1, n2, n3, s] (1 byte each)
// [5-6]  oddRound: LE uint16
// [7-10] oddCount: LE uint32
// [11-12] evenRound: LE uint16
// [13-16] evenCount: LE uint32

export interface NSNftState {
  lotteryNumber: string // 8 hex chars: n1n2n3s (1 byte each)
  oddRound: number
  oddCount: number
  evenRound: number
  evenCount: number
}

export function buildNSCommitment(s: NSNftState): string {
  return (
    '02' +
    s.lotteryNumber +
    leHex(s.oddRound, 2) +
    leHex(s.oddCount, 4) +
    leHex(s.evenRound, 2) +
    leHex(s.evenCount, 4)
  )
}

export function parseNSCommitment(hex: string): NSNftState {
  return {
    lotteryNumber: hex.slice(2, 10),
    oddRound: leHexToNumber(hex.slice(10, 14)),
    oddCount: leHexToNumber(hex.slice(14, 22)),
    evenRound: leHexToNumber(hex.slice(22, 26)),
    evenCount: leHexToNumber(hex.slice(26, 34)),
  }
}

// ─── RoundSwitchControlNFT — 30 bytes ────────────────────────────────────────
// 移除舊版 switchedShardCount；原本的 lastSwitchTime 改為「最後彙整時間」
// （棘輪彙整 64 分片的最大值，每輪開始歸零）。
// [0]     purpose: 0x03
// [1-2]   drawingRound: LE uint16
// [3-10]  cutoffTime: LE int64 (8 bytes，結算輪截止售票時間)
// [11-15] cumulativeSales: LE uint40 (5 bytes，本輪次累積售出彩票)
// [16-23] lastAggregateTime: LE int64 (8 bytes，最後彙整時間；aggregateBatchFlag==1 期間
//         本欄位是「目前為止的中繼最大值」，須配合該旗標判讀；0 = 本輪尚未開始彙整)
// [24-27] stagedRate: LE uint32（暫存匯率，不綁定特定輪次）
// [28]    gameOverFlag: 0x00 = 正常運作；0x01 = 已宣告結束，由 declareGameOver() 寫入後永久不變
// [29]    aggregateBatchFlag: 0 = 本輪尚未彙整或兩批皆已完成；1 = 第一批（32 片）已完成、
//         等待第二批——因 BCH 100,000 bytes 標準交易大小上限，64 片分兩筆各 32 片執行

export interface RSCNftState {
  drawingRound: number
  cutoffTime: bigint
  cumulativeSales: bigint
  lastAggregateTime: bigint
  stagedRate: number
  gameOverFlag: number
  aggregateBatchFlag: number
}

export function buildRSCCommitment(s: RSCNftState): string {
  return (
    '03' +
    leHex(s.drawingRound, 2) +
    leHex(s.cutoffTime, 8) +
    leHex(s.cumulativeSales, 5) +
    leHex(s.lastAggregateTime, 8) +
    leHex(s.stagedRate, 4) +
    leHex(s.gameOverFlag, 1) +
    leHex(s.aggregateBatchFlag, 1)
  )
}

export function parseRSCCommitment(hex: string): RSCNftState {
  return {
    drawingRound: leHexToNumber(hex.slice(2, 6)),
    cutoffTime: leHexToBigInt(hex.slice(6, 22)),
    cumulativeSales: leHexToBigInt(hex.slice(22, 32)),
    lastAggregateTime: leHexToBigInt(hex.slice(32, 48)),
    stagedRate: leHexToNumber(hex.slice(48, 56)),
    gameOverFlag: leHexToNumber(hex.slice(56, 58)),
    aggregateBatchFlag: leHexToNumber(hex.slice(58, 60)),
  }
}

// ─── DrawingNFT — 16 bytes ───────────────────────────────────────────────────
// [0]    purpose: 0x04
// [1-2]  round: LE uint16
// [3-10] expectedDrawTime: LE int64 (8 bytes)
// [11-15] cumulativeSales: LE uint40 (5 bytes)

export interface DrawingNftState {
  round: number
  expectedDrawTime: bigint
  cumulativeSales: bigint
}

export function buildDrawingNftCommitment(s: DrawingNftState): string {
  return (
    '04' +
    leHex(s.round, 2) +
    leHex(s.expectedDrawTime, 8) +
    leHex(s.cumulativeSales, 5)
  )
}

export function parseDrawingNftCommitment(hex: string): DrawingNftState {
  return {
    round: leHexToNumber(hex.slice(2, 6)),
    expectedDrawTime: leHexToBigInt(hex.slice(6, 22)),
    cumulativeSales: leHexToBigInt(hex.slice(22, 32)),
  }
}

// ─── WinningNumberNFT — 16 bytes ─────────────────────────────────────────────
// [0]     purpose: 0x05
// [1-2]   drawRound: LE uint16
// [3]     n1 (1-32)
// [4]     n2 (1-32)
// [5]     n3 (1-32)
// [6]     s  (1-16)
// [7-11]  cumulativeSales: LE uint40 (5 bytes)
// [12-15] saleRate: LE uint32 (本輪實際售票匯率，取自 RSC 被覆寫前的暫存匯率)

export interface WNNftState {
  drawRound: number
  n1: number
  n2: number
  n3: number
  s: number
  cumulativeSales: bigint
  saleRate: number
}

export function buildWNCommitment(s: WNNftState): string {
  return (
    '05' +
    leHex(s.drawRound, 2) +
    leHex(s.n1, 1) +
    leHex(s.n2, 1) +
    leHex(s.n3, 1) +
    leHex(s.s, 1) +
    leHex(s.cumulativeSales, 5) +
    leHex(s.saleRate, 4)
  )
}

export function parseWNCommitment(hex: string): WNNftState {
  return {
    drawRound: leHexToNumber(hex.slice(2, 6)),
    n1: leHexToNumber(hex.slice(6, 8)),
    n2: leHexToNumber(hex.slice(8, 10)),
    n3: leHexToNumber(hex.slice(10, 12)),
    s: leHexToNumber(hex.slice(12, 14)),
    cumulativeSales: leHexToBigInt(hex.slice(14, 24)),
    saleRate: leHexToNumber(hex.slice(24, 32)),
  }
}

// ─── ConfigNFT — 19 bytes (none capability, purpose 0x06) ───────────────────
// 換輪停滯的取消/復原機制（cancelRound()/recoveryRSA()）已隨結算/彙整改版移除，
// pendingRecoveryCount 欄位一併移除。
// [0]     purpose: 0x06
// [1-8]   GENESIS_TIME: LE int64 (8 bytes，創世常數，永久不變)
// [9-12]  PROD_ROUND_PERIOD: LE uint32 (4 bytes, seconds，創世常數，永久不變)
// [13-14] shardCount: LE uint16 (2 bytes，創世常數，永久不變)
// [15-18] settledRate: LE uint32 (4 bytes，每次 aggregate() 改寫為本輪 64 片 SS 的
//         thisNFTRate——即這一輪實際成交匯率；enterDrawingPhase() 讀取後用於 grossRevenue
//         計算，跟 RSC.stagedRate「當下最新已知匯率」互相獨立，不可混用)

export interface ConfigNftState {
  genesisTime: bigint
  roundPeriod: number
  shardCount: number
  settledRate: number
}

export function buildConfigCommitment(s: ConfigNftState): string {
  return (
    '06' +
    leHex(s.genesisTime, 8) +
    leHex(s.roundPeriod, 4) +
    leHex(s.shardCount, 2) +
    leHex(s.settledRate, 4)
  )
}

export function parseConfigCommitment(hex: string): ConfigNftState {
  if (hex.length !== 38) throw new Error(`Invalid ConfigNFT commitment: expected 38 hex chars (19 bytes), got ${hex.length}`)
  if (hex.slice(0, 2) !== '06') throw new Error(`Invalid ConfigNFT purpose byte: expected 06, got ${hex.slice(0, 2)}`)
  return {
    genesisTime: leHexToBigInt(hex.slice(2, 18)),
    roundPeriod: leHexToNumber(hex.slice(18, 26)),
    shardCount: leHexToNumber(hex.slice(26, 30)),
    settledRate: leHexToNumber(hex.slice(30, 38)),
  }
}

// ─── CanceledRoundNFT — 12 bytes (minting capability, purpose 0x07) ─────────
// 由 Drawing.cancelDraw()（開獎逾期）鑄造，送至固定獎池地址，永久保留不銷毀。
// 換輪停滯的取消機制（RoundSwitchControl.cancelRound()）已隨結算/彙整改版移除。
// [0]    purpose: 0x07
// [1-2]  round: LE uint16（被取消的輪次）
// [3-7]  cumulativeSales: LE uint40 (5 bytes)
// [8-11] saleRate: LE uint32

export interface CRNftState {
  round: number
  cumulativeSales: bigint
  saleRate: number
}

export function buildCRCommitment(s: CRNftState): string {
  return (
    '07' +
    leHex(s.round, 2) +
    leHex(s.cumulativeSales, 5) +
    leHex(s.saleRate, 4)
  )
}

export function parseCRCommitment(hex: string): CRNftState {
  return {
    round: leHexToNumber(hex.slice(2, 6)),
    cumulativeSales: leHexToBigInt(hex.slice(6, 16)),
    saleRate: leHexToNumber(hex.slice(16, 24)),
  }
}

// ─── JackpotPoolNFT — 27 bytes ───────────────────────────────────────────────
// [0]     purpose: 0x0A
// [1-2]   accumulateFrom: LE uint16
// [3-4]   currentDrawRound: LE uint16
// [5-8]   winningNumber: [n1, n2, n3, s] (1 byte each)
// [9]     winnerCount: uint8（多少人中獎；一旦寫入不再變動）
// [10]    claimCount: uint8（還有多少人可以領獎；每次領獎遞減）
// [11-18] totalBCH: LE int64（JP累計餘額；中獎後永久凍結為中獎當下的總額）
// [19-26] lastClaimTime: LE int64 (8 bytes)
//
// 新池慣例（尚未開獎）：currentDrawRound = accumulateFrom - 1

export interface JPNftState {
  accumulateFrom: number
  currentDrawRound: number
  n1: number
  n2: number
  n3: number
  s: number
  winnerCount: number
  claimCount: number
  totalBCH: bigint
  lastClaimTime: bigint
}

export function buildJPCommitment(s: JPNftState): string {
  return (
    '0a' +
    leHex(s.accumulateFrom, 2) +
    leHex(s.currentDrawRound, 2) +
    leHex(s.n1, 1) +
    leHex(s.n2, 1) +
    leHex(s.n3, 1) +
    leHex(s.s, 1) +
    leHex(s.winnerCount, 1) +
    leHex(s.claimCount, 1) +
    leHex(s.totalBCH, 8) +
    leHex(s.lastClaimTime, 8)
  )
}

export function parseJPCommitment(hex: string): JPNftState {
  return {
    accumulateFrom: leHexToNumber(hex.slice(2, 6)),
    currentDrawRound: leHexToNumber(hex.slice(6, 10)),
    n1: leHexToNumber(hex.slice(10, 12)),
    n2: leHexToNumber(hex.slice(12, 14)),
    n3: leHexToNumber(hex.slice(14, 16)),
    s: leHexToNumber(hex.slice(16, 18)),
    winnerCount: leHexToNumber(hex.slice(18, 20)),
    claimCount: leHexToNumber(hex.slice(20, 22)),
    totalBCH: leHexToBigInt(hex.slice(22, 38)),
    lastClaimTime: leHexToBigInt(hex.slice(38, 54)),
  }
}

// ─── DonationMessageNFT — 40 bytes (none capability, purpose 0x08) ──────────
// 由 JackpotPool.playerDonation() 鑄造，記錄該次捐款發生的輪次、金額與留言雜湊
// [0]    purpose: 0x08
// [1-2]  round: LE uint16（取自 JackpotPoolNFT 的 currentDrawRound + 1，即本次捐款正在累積的輪次）
// [3-7]  donationTotal: LE uint40 (5 bytes，sats)
// [8-39] messageHash: sha256(OP_RETURN lockingBytecode) 完整 32 bytes

export interface DonationMessageNftState {
  round: number
  donationTotal: bigint
  messageHash: string // 32 bytes hex (64 hex chars)
}

export function buildDonationMessageCommitment(s: DonationMessageNftState): string {
  return (
    '08' +
    leHex(s.round, 2) +
    leHex(s.donationTotal, 5) +
    s.messageHash
  )
}

export function parseDonationMessageCommitment(hex: string): DonationMessageNftState {
  if (hex.length !== 80) throw new Error(`Invalid DonationMessageNFT commitment: expected 80 hex chars (40 bytes), got ${hex.length}`)
  if (hex.slice(0, 2) !== '08') throw new Error(`Invalid DonationMessageNFT purpose byte: expected 08, got ${hex.slice(0, 2)}`)
  return {
    round: leHexToNumber(hex.slice(2, 6)),
    donationTotal: leHexToBigInt(hex.slice(6, 16)),
    messageHash: hex.slice(16, 80),
  }
}

// 對應 contracts/JackpotPool.cash playerDonation() 對 messageLockingBytecode 的驗證
// （1~200 bytes，開頭須為 0x6a）；與 scripts/playerDonation.ts 的組裝方式完全一致
export const MAX_MESSAGE_LOCKING_BYTECODE_BYTES = 200

export function buildMessageLockingBytecode(message?: string): Uint8Array {
  if (!message) return new Uint8Array([0x6a])
  return new Uint8Array([0x6a, ...encodeDataPush(new TextEncoder().encode(message))])
}

export function messageHashHex(messageLockingBytecode: Uint8Array): string {
  return binToHex(sha256.hash(messageLockingBytecode))
}

// buildMessageLockingBytecode() 的反向操作：從 OP_RETURN output 的 lockingBytecode 讀出
// 留言全文。本專案的留言長度上限 200 bytes，push 編碼只會是直接推入（1~75 bytes）或
// OP_PUSHDATA1（76~200 bytes），不會用到 OP_PUSHDATA2/4
export function decodeMessageLockingBytecode(lockingBytecode: Uint8Array): string | null {
  if (lockingBytecode.length <= 1 || lockingBytecode[0] !== 0x6a) return null
  let dataStart: number
  let length: number
  if (lockingBytecode[1] <= 0x4b) {
    length = lockingBytecode[1]
    dataStart = 2
  } else if (lockingBytecode[1] === 0x4c) {
    length = lockingBytecode[2]
    dataStart = 3
  } else {
    return null
  }
  return new TextDecoder().decode(lockingBytecode.slice(dataStart, dataStart + length))
}

// ─── TicketNFT — 14 bytes ────────────────────────────────────────────────────
// 每個 NFT 固定代表 1 張彩票（1 組號碼）
// [0-1]  round: BE uint16
// [2]    ff (separator)
// [3]    n1 (1-32)
// [4]    n2 (1-32)
// [5]    n3 (1-32)
// [6]    s  (1-16)
// [7]    ff (separator)
// [8-11] purchaseRate: BE uint32
// [12]   ff (separator)
// [13]   claimStatus: 低nibble=中獎等級碼(0x00未領/0x01=頭獎/0x02~0x05對應一獎~四獎), bit4(0x10)=已退款, bit5(0x20)=已領頭獎份額退款

export interface TicketNftState {
  round: number
  n1: number
  n2: number
  n3: number
  s: number
  claimStatus: number
  purchaseRate: number
}

export function buildTicketCommitment(s: TicketNftState): string {
  return (
    beHex(s.round, 2) + 'ff' +
    beHex(s.n1, 1) + beHex(s.n2, 1) + beHex(s.n3, 1) + beHex(s.s, 1) + 'ff' +
    beHex(s.purchaseRate, 4) + 'ff' +
    beHex(s.claimStatus, 1)
  )
}

export function parseTicketCommitment(hex: string): TicketNftState {
  if (hex.length !== 28) throw new Error(`Invalid TicketNFT commitment: expected 28 hex chars, got ${hex.length}`)
  return {
    round: parseInt(hex.slice(0, 4), 16),
    // hex[4:6] = 'ff' (separator)
    n1: parseInt(hex.slice(6, 8), 16),
    n2: parseInt(hex.slice(8, 10), 16),
    n3: parseInt(hex.slice(10, 12), 16),
    s: parseInt(hex.slice(12, 14), 16),
    // hex[14:16] = 'ff' (separator)
    purchaseRate: parseInt(hex.slice(16, 24), 16),
    // hex[24:26] = 'ff' (separator)
    claimStatus: parseInt(hex.slice(26, 28), 16),
  }
}

// ─── Draw numbers computation ────────────────────────────────────────────────

/**
 * Computes the winning numbers from a 64-byte Schnorr signature hex string.
 * Uses libauth's sha256 (works in insecure/non-HTTPS contexts, unlike
 * window.crypto.subtle which is only available in secure contexts).
 */
export async function computeDrawNumbers(sigAfterHex: string): Promise<{
  n1: number; n2: number; n3: number; s: number; idx: number
}> {
  const sigBytes = hexToBin(sigAfterHex.padStart(128, '0'))
  const seed = sha256.hash(sigBytes)

  // Simulate CashScript Script Number semantics (signed LE, MSB of the full 32
  // bytes is the sign bit) — contract does int(sha256(sigAfter)), i.e. all 32
  // bytes are decoded as the Script Number, not just the first 4.
  const negative = (seed[31] & 0x80) !== 0
  const mag = new Uint8Array(seed)
  mag[31] &= 0x7f
  let raw = 0n
  for (let i = 31; i >= 0; i--) {
    raw = (raw << 8n) | BigInt(mag[i])
  }
  if (negative) raw = -raw
  const idx = Number((raw < 0n ? -raw : raw) % 79360n)

  const s = (idx % 16) + 1
  const comboIdx = Math.floor(idx / 16)

  let c3 = 2
  while (c3 + 1 <= 31 && comb(c3 + 1, 3) <= comboIdx) c3++
  const n3 = c3 + 1
  const rem2 = comboIdx - comb(c3, 3)

  let c2 = 1
  while (c2 + 1 <= c3 - 1 && comb(c2 + 1, 2) <= rem2) c2++
  const n2 = c2 + 1
  const n1 = rem2 - comb(c2, 2) + 1

  return { n1, n2, n3, s, idx }
}

function comb(n: number, k: number): number {
  if (n < k || n < 0) return 0
  if (k === 1) return n
  if (k === 2) return (n * (n - 1)) / 2
  if (k === 3) return (n * (n - 1) * (n - 2)) / 6
  return 0
}

// ─── Lottery number helpers ───────────────────────────────────────────────────

export function parseLotteryNumber(hex: string): { n1: number; n2: number; n3: number; s: number } {
  return {
    n1: parseInt(hex.slice(0, 2), 16),
    n2: parseInt(hex.slice(2, 4), 16),
    n3: parseInt(hex.slice(4, 6), 16),
    s: parseInt(hex.slice(6, 8), 16),
  }
}

export function buildLotteryNumber(n1: number, n2: number, n3: number, s: number): string {
  return (
    n1.toString(16).padStart(2, '0') +
    n2.toString(16).padStart(2, '0') +
    n3.toString(16).padStart(2, '0') +
    s.toString(16).padStart(2, '0')
  )
}

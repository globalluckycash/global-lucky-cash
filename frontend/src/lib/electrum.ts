/**
 * electrum.ts — On-chain data queries via Electrum
 * All state reads go through this module.
 */

import { decodeTransaction } from '@bitauth/libauth'
import { i18n } from '@/i18n'
import { provider, getConfig, getNumberSalesContract, getRoundShardAuthContract } from './contractConfig'
import { hexToBin, binToHex, leHex, leHexToBigInt } from './bytes'
import {
  parseRSCCommitment,
  parseRSACommitment,
  parseSSCommitment,
  parseNSCommitment,
  parseWNCommitment,
  parseJPCommitment,
  parseTicketCommitment,
  parseDrawingNftCommitment,
  parseDonationMessageCommitment,
  parseCRCommitment,
  decodeMessageLockingBytecode,
  buildLotteryNumber,
  type RSCNftState,
  type SSNftState,
  type WNNftState,
  type JPNftState,
  type DrawingNftState,
  type DonationMessageNftState,
  type CRNftState,
} from './nftDecode'
import type { Utxo, ParsedTicket, RsaShardUtxo, SsShardUtxo, NsUtxo } from '@/types'

// ─── Connection error translation ────────────────────────────────────────────

/**
 * @electrum-cash/network 斷線時有兩種「沒有意義訊息」的情況，這裡統一轉譯成玩家
 * 看得懂的提示，其餘真正有意義的錯誤原樣拋出，不吞掉：
 * 1. 還在等待回應的請求全部被 reject 成 new Error("Connection lost")
 *    （見該套件 onConnectionDisconnect()）。
 * 2. ElectrumConnection.connect() 斷線時呼叫的是不帶參數的 reject()
 *    （見該套件 connect() 內的 connectionResolver），reject 出來的其實是
 *    真正的 undefined，不是 Error——沒有訊息可用，若不特別處理，String(undefined)
 *    這種字面值會直接被丟到 toast/畫面上給玩家看。
 */
function translateConnectionError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(i18n.global.t('errors.network_error'))
  if (err.message.includes('Connection lost')) return new Error(i18n.global.t('errors.network_error'))
  return err
}

async function withConnectionErrorTranslation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw translateConnectionError(err)
  }
}

// ─── Raw UTXO query ───────────────────────────────────────────────────────────

export async function getAddressUtxos(address: string): Promise<Utxo[]> {
  const utxos = await withConnectionErrorTranslation(() => provider.getUtxos(address))
  return utxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    valueSats: u.satoshis,
    token: u.token
      ? {
          category: u.token.category,
          nft: u.token.nft
            ? {
                capability: u.token.nft.capability as 'none' | 'mutable' | 'minting',
                commitment: u.token.nft.commitment,
              }
            : undefined,
          amount: u.token.amount,
        }
      : undefined,
  }))
}

/**
 * 查一個地址底下所有符合某個特定 NFT commitment 的 UTXO——用來在簽名逾時/連線中斷後
 * 查證「這筆交易是不是其實已經在鏈上成功了」（見 walletBridge.ts 呼叫端），而不是重新
 * 推算 txid：BCH 的 txid 依賴完整序列化交易（含每個 input 的 unlocking bytecode），玩家
 * 自付手續費的 input 要等錢包簽名回應才知道實際內容，dApp 端送出簽名請求前不可能預先
 * 算出最終 txid；但「新 commitment 會出現在哪個地址」是 dApp 端在建交易時就已經決定
 * 好的，可以直接查證。回傳陣列（可能為空）而非單一結果——同參數重複操作（例如玩家重複
 * 買同一組號碼）會產生 byte-for-byte 相同的 commitment，呼叫端需要比對「哪些是新的」，
 * 不能只看「有沒有」。
 */
export async function findUtxosByCommitment(address: string, category: string, commitmentHex: string): Promise<Utxo[]> {
  const utxos = await getAddressUtxos(address)
  return utxos.filter(u => u.token?.category === category && u.token?.nft?.commitment === commitmentHex)
}

/** 只需要知道「有沒有」的呼叫端用這個即可，見 findUtxosByCommitment() 的說明 */
export async function findUtxoByCommitment(address: string, category: string, commitmentHex: string): Promise<Utxo | null> {
  return (await findUtxosByCommitment(address, category, commitmentHex))[0] ?? null
}

// ─── Raw transaction lookup (deposit recovery by txid) ────────────────────────

export interface TxOutputInfo {
  vout: number
  valueSats: bigint
  lockingBytecodeHex: string
}

/**
 * Fetch and decode a transaction's outputs by txid — used to locate a TicketDeposit payment
 * when a player only has their wallet's recorded txid (e.g. closed the buy window before
 * confirming). A TicketDeposit contract address is a P2SH hash of its compiled bytecode, so
 * the (round, lotteryNumbers, buyerPkh) it commits to can't be reversed from the address alone —
 * the caller must recompute candidate addresses and match them against these outputs.
 */
export async function fetchTransactionOutputs(txid: string): Promise<TxOutputInfo[]> {
  let rawHex: string
  try {
    rawHex = await provider.getRawTransaction(txid)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Connection lost')) throw translateConnectionError(err)
    throw new Error(`找不到此交易，請確認 Transaction ID 是否正確（${msg}）`)
  }
  const decoded = decodeTransaction(hexToBin(rawHex))
  if (typeof decoded === 'string') throw new Error(`交易解碼失敗：${decoded}`)
  return decoded.outputs.map((o, vout) => ({
    vout,
    valueSats: o.valueSatoshis,
    lockingBytecodeHex: binToHex(o.lockingBytecode),
  }))
}

// ─── RSC state ────────────────────────────────────────────────────────────────

export async function fetchRSCState(): Promise<{ state: RSCNftState; valueSats: bigint }> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.roundSwitchControlContract.address)
  const rscUtxo = utxos.find(u =>
    u.token?.category === cfg.authNftCategoryId &&
    u.token?.nft?.commitment.startsWith('03')
  )
  if (!rscUtxo?.token?.nft) throw new Error('RSC UTXO not found')
  return {
    state: parseRSCCommitment(rscUtxo.token.nft.commitment),
    valueSats: rscUtxo.valueSats,
  }
}

// ─── WinningNumberNFT ─────────────────────────────────────────────────────────

export async function fetchLatestWinningNumber(): Promise<WNNftState | null> {
  const history = await fetchWinningNumberHistory(1)
  return history[0] ?? null
}

export async function fetchWinningNumberHistory(limit = 20): Promise<WNNftState[]> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.fixedPrizePoolContract.address)
  const wnUtxos = utxos
    .filter(u =>
      u.token?.category === cfg.authNftCategoryId &&
      u.token?.nft?.commitment.startsWith('05')
    )
    .map(u => parseWNCommitment(u.token!.nft!.commitment))
    .sort((a, b) => b.drawRound - a.drawRound)
  return wnUtxos.slice(0, limit)
}

// ─── JackpotPool state ────────────────────────────────────────────────────────

export async function fetchCurrentJackpotState(): Promise<{ state: JPNftState; valueSats: bigint } | null> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.jackpotPoolContract.address)
  // Accumulating pool: winnerCount == 0 (not yet recorded a winner this cycle).
  // claimCount == 0 alone is ambiguous — a fully-claimed archived pool also has claimCount == 0.
  const jpUtxo = utxos.find(u => {
    if (u.token?.category !== cfg.authNftCategoryId) return false
    if (!u.token?.nft?.commitment.startsWith('0a')) return false
    const s = parseJPCommitment(u.token.nft.commitment)
    return s.winnerCount === 0
  })
  if (!jpUtxo?.token?.nft) return null
  return {
    state: parseJPCommitment(jpUtxo.token.nft.commitment),
    valueSats: jpUtxo.valueSats,
  }
}

export async function fetchAllJackpotPools(): Promise<Array<{ state: JPNftState; utxo: Utxo }>> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.jackpotPoolContract.address)
  return utxos
    .filter(u =>
      u.token?.category === cfg.authNftCategoryId &&
      u.token?.nft?.commitment.startsWith('0a')
    )
    .map(u => ({
      state: parseJPCommitment(u.token!.nft!.commitment),
      utxo: u,
    }))
}

// ─── DonationMessageNFT ────────────────────────────────────────────────────────
// 由 playerDonation() 鑄造，永久留在 JackpotPool 合約地址、不會被任何 function 花掉
// （見 contracts/JackpotPool.cash），因此過濾 purpose 08 即可取得完整歷史捐款清單，
// 不需要額外的索引服務。

export interface DonationMessageEntry {
  utxo: Utxo
  state: DonationMessageNftState
}

/**
 * 取得所有歷史捐款的輕量 metadata（round／金額／留言雜湊），依 round 降序排列。
 * 留言全文需另外呼叫 fetchDonationMessageText()（每筆多一次 raw tx 查詢，故拆開，
 * 供呼叫端依捲動進度分批延遲載入）。
 */
export async function fetchDonationMessageEntries(): Promise<DonationMessageEntry[]> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.jackpotPoolContract.address)
  return utxos
    .filter(u =>
      u.token?.category === cfg.authNftCategoryId &&
      u.token?.nft?.commitment.startsWith('08')
    )
    .map(u => ({
      utxo: u,
      state: parseDonationMessageCommitment(u.token!.nft!.commitment),
    }))
    .sort((a, b) => b.state.round - a.state.round)
}

/** 從鑄造 DonationMessageNFT 的那筆交易讀出 OP_RETURN 留言全文；無留言回傳 null。 */
export async function fetchDonationMessageText(txid: string): Promise<string | null> {
  const outputs = await fetchTransactionOutputs(txid)
  const opReturn = outputs.find(o => o.lockingBytecodeHex.startsWith('6a'))
  if (!opReturn) return null
  return decodeMessageLockingBytecode(hexToBin(opReturn.lockingBytecodeHex))
}

/**
 * 篩選出屬於「目前累積週期」的捐款——用於首頁顯示，例如頭獎從第 1 期累積到第 19 期才
 * 中獎，第 5 期收到的捐款要一直顯示到第 19 期中獎為止，第 20 期（新池 accumulateFrom=20）
 * 開始就不再顯示。
 *
 * 規則：donation.round >= currentPool.state.accumulateFrom。DonationMessageNFT 的 round
 * 由合約取「JackpotPoolNFT.currentDrawRound + 1」寫入（見 JackpotPool.playerDonation()），
 * 恆等於捐款當下累積池的 accumulateFrom，不會出現 0 這種需另外比對區塊高度排歧義的情況。
 */
export function filterCurrentCycleDonations(
  entries: DonationMessageEntry[],
  currentPool: { state: JPNftState },
): DonationMessageEntry[] {
  const { accumulateFrom } = currentPool.state
  return entries.filter(e => e.state.round >= accumulateFrom)
}

// ─── FixedPrizePool balance ───────────────────────────────────────────────────
// FPP holds no NFT — funds sit as (possibly many) plain BCH UTXOs at its address.

export async function fetchFixedPrizePoolBalance(): Promise<bigint> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.fixedPrizePoolContract.address)
  return utxos
    .filter(u => !u.token)
    .reduce((sum, u) => sum + u.valueSats, 0n)
}

// ─── PlatformPool balance ─────────────────────────────────────────────────────
// PlatformPool holds no NFT — funds sit as (possibly many) plain BCH UTXOs at its address.

export async function fetchPlatformPoolBalance(): Promise<bigint> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.platformPoolContract.address)
  return utxos
    .filter(u => !u.token)
    .reduce((sum, u) => sum + u.valueSats, 0n)
}

// ─── Player tickets ───────────────────────────────────────────────────────────

export async function fetchPlayerTickets(cashAddr: string): Promise<ParsedTicket[]> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cashAddr)
  // All NFTs at player P2PKH with our category are TicketNFTs.
  // System NFTs (purpose 01-0A) only live at contract addresses, never at P2PKH — but
  // dev/test tooling (e.g. scripts/mintNft.ts) can freely mint arbitrary commitments to
  // any address, so also guard on commitment length rather than trusting category alone.
  const ticketUtxos = utxos.filter(u =>
    u.token?.category === cfg.authNftCategoryId &&
    u.token?.nft &&
    u.token.nft.commitment.length === 28
  )
  return ticketUtxos.map(u => ({
    ...parseTicketCommitment(u.token!.nft!.commitment),
    utxo: u,
    prizeLevel: null,
  }))
}

// ─── RSA shard ────────────────────────────────────────────────────────────────
// RoundShardAuthNFT 已改為每個分片各自獨立合約地址（見 contracts/RoundShardAuth.cash
// shardId 建構參數，規格書 4.2）。「找某個特定分片」可以只查那一個地址；但「彙總全部
// 分片」（活動總銷量）仍須逐一查詢 shardCount 個地址，見下方各函式說明。

/**
 * 查詢單一分片自己的獨立地址目前的總餘額——供 /verify 頁面讓玩家自行核對「目前地址」與
 * 「目前餘額」是否與鏈上一致。售票款直接累加在 RSA NFT UTXO 的 value 欄位（見
 * contracts/RoundShardAuth.cash sellTicket() 的
 * tx.outputs[0].value == tx.inputs[0].value + ticketPrice * ticketQuantity），所以這裡加總
 * 該地址所有 UTXO 的 sats，而不像 FixedPrizePool/PlatformPool 那樣濾掉帶 token 的 UTXO。
 */
export async function fetchRoundShardAuthBalance(shardId: number): Promise<bigint> {
  const address = getRoundShardAuthContract(leHex(shardId, 2)).address
  const utxos = await getAddressUtxos(address)
  return utxos.reduce((sum, u) => sum + u.valueSats, 0n)
}

/** 查詢單一分片自己的獨立地址，回傳其 RSA UTXO（該地址恆定只會有這個分片的 1 個 UTXO）*/
async function fetchRSAShardByIndex(shardId: number): Promise<RsaShardUtxo | null> {
  const cfg = getConfig()
  const address = getRoundShardAuthContract(leHex(shardId, 2)).address
  const utxos = await getAddressUtxos(address)
  const u = utxos.find(u =>
    u.token?.category === cfg.authNftCategoryId && u.token?.nft?.commitment.startsWith('01')
  )
  return u ? { ...u, shardState: parseRSACommitment(u.token!.nft!.commitment) } : null
}

/**
 * 取得「全部」分片目前的 RSA 狀態（不分 round，呼叫端自行依 shardState.sellingRound 篩選）。
 * 逐一查詢 shardCount 個分片的獨立地址 —— 用於需要彙總全部分片的場合（活動總銷量顯示、
 * 批次換輪/復原取得完整清單），單一分片的查詢請改用 fetchRandomRSAShard()。
 *
 * 過去這裡是依 round 篩選（fetchEligibleRSAShards(round)），refreshHot() 同時要
 * currentRound 跟 currentRound+1 兩種篩選結果時，各自呼叫一次——但兩次查的是完全相同的
 * shardCount 個地址，只是篩選條件不同，等於同一批鏈上資料重複查兩遍（近截止時間可疊到
 * 2×shardCount 併發）。改成不篩選、一次查完，呼叫端在記憶體裡篩兩次即可，不必再查第二次。
 */
export async function fetchAllRSAShardStates(): Promise<RsaShardUtxo[]> {
  const cfg = getConfig()
  const results = await Promise.all(
    Array.from({ length: cfg.shardCount }, (_, shardId) => fetchRSAShardByIndex(shardId))
  )
  return results.filter((s): s is RsaShardUtxo => s !== null)
}

/**
 * 隨機挑一個分片、直接查詢該分片自己的獨立地址（不枚舉全部 shardCount 個地址），避免
 * 大量裝置同時查詢同一共用地址造成阻塞（規格書 4.2 的設計動機）。多數時候所有分片都同步
 * 在同一個 round，第一次嘗試就會命中；只有在換輪交界的短暫窗口才需要重試幾次。
 */
export async function fetchRandomRSAShard(round: number): Promise<RsaShardUtxo> {
  const cfg = getConfig()
  const maxAttempts = Math.min(cfg.shardCount, 20)
  const tried = new Set<number>()
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let shardId: number
    do {
      shardId = Math.floor(Math.random() * cfg.shardCount)
    } while (tried.has(shardId) && tried.size < cfg.shardCount)
    tried.add(shardId)

    const shard = await fetchRSAShardByIndex(shardId)
    if (shard && shard.shardState.sellingRound === round) return shard
  }
  throw new Error('No eligible RSA shard found')
}

// ─── SS (ShardSettlement) shard ──────────────────────────────────────────────
// ShardSettlementNFT 與對應分片的 RoundShardAuthNFT 同地址（見 contracts/RoundShardAuth.cash），
// 一片一份，靠 commitment 開頭 purpose byte（01=RSA／09=SS）與 RSA 區分。

const SETTLE_QUERY_CONCURRENCY = 32

/** 查詢單一分片自己的獨立地址，回傳該分片的 RSA + SS 兩張 UTXO（settle() 兩者都需要）*/
export async function fetchShardUtxos(shardId: number): Promise<{ rsaUtxo: RsaShardUtxo; ssUtxo: SsShardUtxo } | null> {
  const cfg = getConfig()
  const address = getRoundShardAuthContract(leHex(shardId, 2)).address
  const utxos = await getAddressUtxos(address)
  const rsaRaw = utxos.find(u => u.token?.category === cfg.authNftCategoryId && u.token?.nft?.commitment.startsWith('01'))
  const ssRaw = utxos.find(u => u.token?.category === cfg.authNftCategoryId && u.token?.nft?.commitment.startsWith('09'))
  if (!rsaRaw?.token?.nft || !ssRaw?.token?.nft) return null
  return {
    rsaUtxo: { ...rsaRaw, shardState: parseRSACommitment(rsaRaw.token.nft.commitment) },
    ssUtxo: { ...ssRaw, ssState: parseSSCommitment(ssRaw.token.nft.commitment) },
  }
}

/**
 * 併發掃描全部 shardCount 個分片地址，取得每一片的 SS 狀態，供 UI 顯示結算/彙整進度
 * （對齊 scripts/settle.ts findEligibleShards() 與 scripts/aggregate.ts
 * findAllPendingAggregateSSUtxos() 共用的掃描邏輯，這裡不篩選 phase，一次撈齊由呼叫端過濾）。
 */
export async function fetchAllSSStates(): Promise<Array<{ shardId: number; utxo: Utxo; state: SSNftState }>> {
  const cfg = getConfig()
  const found: Array<{ shardId: number; utxo: Utxo; state: SSNftState } | undefined> = new Array(cfg.shardCount)
  let nextShardId = 0
  async function worker(): Promise<void> {
    while (true) {
      const shardId = nextShardId++
      if (shardId >= cfg.shardCount) return
      const address = getRoundShardAuthContract(leHex(shardId, 2)).address
      const utxos = await getAddressUtxos(address)
      const ssUtxo = utxos.find(u => u.token?.category === cfg.authNftCategoryId && u.token?.nft?.commitment.startsWith('09'))
      if (!ssUtxo?.token?.nft) continue
      found[shardId] = { shardId, utxo: ssUtxo, state: parseSSCommitment(ssUtxo.token.nft.commitment) }
    }
  }
  const laneCount = Math.min(SETTLE_QUERY_CONCURRENCY, cfg.shardCount)
  await Promise.all(Array.from({ length: laneCount }, () => worker()))
  const result: Array<{ shardId: number; utxo: Utxo; state: SSNftState }> = []
  for (const entry of found) if (entry) result.push(entry)
  return result
}

/** 取得目前已達截止售票時間、可觸發 settle() 的分片編號清單（phase=0 待結算且 now>=sellingCutoffTime）*/
export async function fetchSettleEligibleShardIds(now: bigint): Promise<number[]> {
  const all = await fetchAllSSStates()
  return all
    .filter(({ state }) => state.phase === 0 && now >= state.sellingCutoffTime)
    .map(({ shardId }) => shardId)
}

/** 取得指定結算輪已達「待彙整」狀態（phase=1 且 round===drawingRound）的全部 SS UTXO，供檢查 aggregate() 是否就緒及建構其交易輸入 */
export async function fetchAggregateReadySSUtxos(drawingRound: number): Promise<SsShardUtxo[]> {
  const all = await fetchAllSSStates()
  return all
    .filter(({ state }) => state.phase === 1 && state.round === drawingRound)
    .map(({ utxo, state }) => ({ ...utxo, ssState: state }))
}

// ─── NumberSales UTXO ─────────────────────────────────────────────────────────

export async function fetchNSUtxo(n1: number, n2: number, n3: number, s: number): Promise<NsUtxo> {
  return fetchNSByLotteryNumber(n1, n2, n3, s)
}

export async function fetchNSByLotteryNumber(n1: number, n2: number, n3: number, s: number): Promise<NsUtxo> {
  const target = buildLotteryNumber(n1, n2, n3, s)
  const address = getNumberSalesContract(target).address
  const utxos = await getAddressUtxos(address)
  const nsUtxo = utxos[0] // 每組號碼各自獨立合約地址，恆定只有這一組號碼的 1 個 UTXO
  if (!nsUtxo?.token?.nft) throw new Error(`NS UTXO not found for ${n1},${n2},${n3},${s}`)
  return {
    ...nsUtxo,
    nsState: parseNSCommitment(nsUtxo.token.nft.commitment),
  }
}

// ─── WN at JackpotPool (for verifyWin) ───────────────────────────────────────

export async function fetchWNAtJackpotPool(): Promise<Utxo | null> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.jackpotPoolContract.address)
  return utxos.find(u =>
    u.token?.category === cfg.authNftCategoryId &&
    u.token?.nft?.commitment.startsWith('05')
  ) ?? null
}

// ─── RSC UTXO (raw, for composables that need to pass it as input) ────────────

export async function fetchRSCUtxo(): Promise<Utxo> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.roundSwitchControlContract.address)
  const rscUtxo = utxos.find(u =>
    u.token?.category === cfg.authNftCategoryId &&
    u.token?.nft?.commitment.startsWith('03')
  )
  if (!rscUtxo) throw new Error('RSC UTXO not found')
  return rscUtxo
}

// ─── ConfigNFT UTXO (raw, for composables that need to pass it as input) ─────
// ConfigNFT sits at the RSC contract address, none capability, purpose 0x06
// (19 bytes = 38 hex chars) — needed by enterDrawingPhase()'s useConfig() input
// to recompute the new cutoffTime from genesisTime + roundPeriod and read
// settledRate for grossRevenue, and by aggregate()'s useConfigForAggregate() input.

export async function fetchConfigUtxo(): Promise<Utxo> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.roundSwitchControlContract.address)
  const configUtxo = utxos.find(u =>
    u.token?.category === cfg.authNftCategoryId &&
    u.token?.nft?.capability === 'none' &&
    u.token?.nft?.commitment.startsWith('06') &&
    u.token?.nft?.commitment.length === 38
  )
  if (!configUtxo) throw new Error('ConfigNFT UTXO not found')
  return configUtxo
}

// ─── FPP funding UTXOs (raw plain BCH, no NFT) ────────────────────────────────
// Used to fund claimFixedPrize()'s payout; sorted largest-first so callers can
// greedily pick as few UTXOs as possible to cover the prize + fee.

export async function fetchFPPFundingUtxos(): Promise<Utxo[]> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.fixedPrizePoolContract.address)
  return utxos
    .filter(u => !u.token)
    .sort((a, b) => (a.valueSats < b.valueSats ? 1 : a.valueSats > b.valueSats ? -1 : 0))
}

// ─── DrawingNFT UTXO (raw) ────────────────────────────────────────────────────

export async function fetchDrawingNftUtxo(): Promise<Utxo | null> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.drawingContract.address)
  return utxos.find(u =>
    u.token?.category === cfg.authNftCategoryId &&
    u.token?.nft?.commitment.startsWith('04')
  ) ?? null
}

/** Decoded DrawingNFT state — exists only while its round is waiting to be drawn. */
export async function fetchDrawingNftState(): Promise<DrawingNftState | null> {
  const utxo = await fetchDrawingNftUtxo()
  if (!utxo?.token?.nft) return null
  return parseDrawingNftCommitment(utxo.token.nft.commitment)
}

// ─── WN at FixedPrizePool for a specific round ────────────────────────────────

export async function fetchWNAtFPPForRound(round: number): Promise<Utxo | null> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.fixedPrizePoolContract.address)
  return utxos.find(u => {
    if (u.token?.category !== cfg.authNftCategoryId) return false
    if (!u.token?.nft?.commitment.startsWith('05')) return false
    const wn = parseWNCommitment(u.token.nft.commitment)
    return wn.drawRound === round
  }) ?? null
}

// ─── CanceledRoundNFT at FixedPrizePool ───────────────────────────────────────
// 由 Drawing.cancelDraw()（開獎逾期）鑄造，送至固定獎池地址，永久保留不銷毀
// （見 contracts/FixedPrizePool.cash claimCanceledRoundRefund()）。換輪停滯的取消機制
// （RoundSwitchControl.cancelRound()）已隨結算/彙整改版移除。

export interface CanceledRoundEntry {
  utxo: Utxo
  state: CRNftState
}

/** 取得某一期的 CanceledRoundNFT（供單張彩票申請退款時使用）；該期未被取消則回傳 null。 */
export async function fetchCRUtxoForRound(round: number): Promise<Utxo | null> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.fixedPrizePoolContract.address)
  return utxos.find(u => {
    if (u.token?.category !== cfg.authNftCategoryId) return false
    if (u.token?.nft?.capability !== 'minting') return false
    if (!u.token?.nft?.commitment.startsWith('07')) return false
    return parseCRCommitment(u.token.nft.commitment).round === round
  }) ?? null
}

/** 取得全部已被取消的輪次（供我的彩票頁面判斷哪些期數可以申請退款）。 */
export async function fetchAllCanceledRounds(): Promise<CanceledRoundEntry[]> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.fixedPrizePoolContract.address)
  return utxos
    .filter(u =>
      u.token?.category === cfg.authNftCategoryId &&
      u.token?.nft?.capability === 'minting' &&
      u.token?.nft?.commitment.startsWith('07')
    )
    .map(u => ({ utxo: u, state: parseCRCommitment(u.token!.nft!.commitment) }))
}

// ─── Jackpot Pool UTXO (raw) ──────────────────────────────────────────────────

export async function fetchJackpotPoolUtxo(): Promise<Utxo> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.jackpotPoolContract.address)
  const jpUtxo = utxos.find(u =>
    u.token?.category === cfg.authNftCategoryId &&
    u.token?.nft?.capability === 'minting' &&
    u.token?.nft?.commitment.startsWith('0a') &&
    parseJPCommitment(u.token.nft.commitment).winnerCount === 0
  )
  if (!jpUtxo) throw new Error('Jackpot Pool UTXO not found')
  return jpUtxo
}

/**
 * 誤送至 JackpotPool 合約地址、不帶任何 NFT 的零散 plain BCH——只能透過
 * collectDonation()／spendDonation() 解鎖（見 contracts/JackpotPool.cash），
 * 供 useCollectDonation 清掃併入頭獎。
 */
export async function fetchOrphanDonationUtxos(): Promise<Utxo[]> {
  const cfg = getConfig()
  const utxos = await getAddressUtxos(cfg.jackpotPoolContract.address)
  return utxos.filter(u => !u.token)
}

// ─── Player plain BCH UTXOs (for fee inputs) ─────────────────────────────────

export async function fetchPlayerBchUtxos(address: string): Promise<Utxo[]> {
  const utxos = await getAddressUtxos(address)
  return utxos.filter(u => !u.token)
}

// ─── Chain time (MTP) ─────────────────────────────────────────────────────────

/**
 * 透過 Electrum protocol 取得 BCH 鏈上的 MTP（Median Time Past）。
 * MTP = 最近 11 個區塊 timestamp 排序後的中位數。
 *
 * 合約的 tx.time 比對的就是 MTP，而非系統時鐘，因此 setLocktime() 一律要用這個值，
 * 不能用 Date.now()（見 scripts/utils/time.ts 的對應實作）。
 */
export async function getBchMTP(): Promise<bigint> {
  const { height } = await withConnectionErrorTranslation(() =>
    provider.performRequest('blockchain.headers.subscribe')
  ) as { height: number; hex: string }

  const startHeight = Math.max(0, height - 10)
  const count = height - startHeight + 1

  const { hex } = await withConnectionErrorTranslation(() =>
    provider.performRequest('blockchain.block.headers', startHeight, count)
  ) as { count: number; hex: string; max: number }

  // BCH block header = 80 bytes = 160 hex chars
  // timestamp 欄位：bytes 68–71（little-endian uint32），hex offset = 136
  const HEADER_HEX_LEN = 160
  const TS_HEX_OFFSET = 136

  const timestamps: number[] = []
  for (let i = 0; i < count; i++) {
    const header = hex.slice(i * HEADER_HEX_LEN, (i + 1) * HEADER_HEX_LEN)
    const tsHex = header.slice(TS_HEX_OFFSET, TS_HEX_OFFSET + 8)
    // reverse byte order (LE → BE) then parse
    const ts = parseInt(
      tsHex.slice(6, 8) + tsHex.slice(4, 6) + tsHex.slice(2, 4) + tsHex.slice(0, 2),
      16,
    )
    timestamps.push(ts)
  }

  timestamps.sort((a, b) => a - b)
  return BigInt(timestamps[Math.floor(timestamps.length / 2)]) - 1n
}

// ─── Draw evidence trail (fairness verification) ───────────────────────────────
// 不幫玩家算好結果，而是把「售票結算 → 資金彙整 → 進入開獎階段 → 開獎」整條鏈路上
// 每一步的 txid 原樣交給玩家，讓玩家自行拿去 Bitcoin Cash explorer 核對——不對任何
// 步驟下驗證結論。
//
// 起點：draw() 的 Output[0] 就是 WinningNumberNFT（送至 FixedPrizePool，minting），
// 該 UTXO 永久停留在 FPP 合約地址，不需要掃描任何合約地址的完整歷史。但玩家兌獎
// （claimFixedPrize()／claimJackpotShareRefund()）會把這張 WN NFT 原樣消費、送回同一
// 地址，所以「目前查到的 UTXO」不一定就是 draw() 本身鑄造的那筆——須先用 resolveDrawTx()
// 沿著 Input[1] 往回追出真正的 draw() 交易，才能繼續往下走。後續四段證據彼此透過
// 「這筆交易花的是哪一筆前手交易」直接串起來，全部順著 input 的 outpoint 往回追即可：
//   draw() Input[0]（DrawingNFT）                的前手 = enterDrawingPhase() 交易
//   enterDrawingPhase() Input[1]（RSC NFT）       的前手 = aggregate() 第二批（batch B）交易
//   aggregate() batch B 的 Input[0]（RSC NFT）    的前手 = aggregate() 第一批（batch A）交易
//   兩批 aggregate() 各自 Input[1..batchSize]（合計 64 張 SS NFT）的前手 = 各分片自己的 settle() 交易
// （見 contracts/RoundSwitchControl.cash draw()/aggregate()/enterDrawingPhase() 的
// 交易結構註解、contracts/RoundShardAuth.cash settle() 的 Output[1]）。
//
// libauth decodeTransaction() 回傳的 outpointTransactionHash 已經是「UI 顯示順序」
// （見官方型別註解 hashTransactionUiOrder），不能再反轉一次位元組順序，否則會查到
// 不存在的 txid（daemon 回 code -5 "No such mempool or blockchain transaction"）。

export interface DrawTrail {
  round: number
  found: boolean
  drawTxid: string | null
  enterDrawingPhaseTxid: string | null
  /**
   * aggregate() 現在分兩批各處理 cfg.shardCount/2 片（見 scripts/aggregate.ts，避免單筆交易
   * 超過 BCH 標準交易大小上限）；batchB 是 enterDrawingPhase() 直接花費的那筆，batchA 是
   * batchB 自己 RSC NFT 的前手交易。batchB 才帶有全體 64 片彙整後的最終 lastAggregateTime。
   */
  aggregateTxids: { batchA: string | null; batchB: string | null }
  /** 依 shardId（0-based）排列，長度 = cfg.shardCount；查無對應交易的分片為 null */
  settleTxids: Array<string | null>
  /** enterDrawingPhase 交易中鎖定的預計開獎時間（Unix 秒），用於產生 oracle API 查詢連結 */
  drawTimeSecs: number | null
}

async function getRawTx(txid: string) {
  try {
    const rawHex = await provider.getRawTransaction(txid)
    const decoded = decodeTransaction(hexToBin(rawHex))
    return typeof decoded === 'string' ? null : decoded
  } catch {
    return null
  }
}

type DecodedTx = NonNullable<Awaited<ReturnType<typeof getRawTx>>>

/**
 * FixedPrizePool 上的 WinningNumberNFT 在每次 claimFixedPrize()／claimJackpotShareRefund()
 * 都會被 Input[1] 消費、原樣送回 Output[1]（見 contracts/FixedPrizePool.cash），永久停留在
 * 該合約地址上。因此「目前查到的 WN UTXO」的 txid 不一定是 draw() 本身——只要玩家已經兌過獎，
 * 撈到的就會是最新一筆兌獎交易，其 Input[0] 是被銷毀的 TicketNFT 而非 DrawingNFT，往回推會
 * 完全推錯路。這裡沿著 Input[1] 往回追，直到追到的前手輸出不再是同一輪的 WN NFT 為止，
 * 那一筆才是真正鑄造 WN NFT 的 draw() 交易。
 */
async function resolveDrawTx(
  startTxid: string,
  round: number,
): Promise<{ txid: string; decoded: DecodedTx } | null> {
  let txid = startTxid
  let decoded = await getRawTx(txid)
  if (!decoded) return null

  while (decoded.inputs[1]) {
    const prevTxid = binToHex(decoded.inputs[1].outpointTransactionHash)
    const prevDecoded = await getRawTx(prevTxid)
    const prevOutput = prevDecoded?.outputs[decoded.inputs[1].outpointIndex]
    if (!prevOutput?.token?.nft) break
    const commitmentHex = binToHex(prevOutput.token.nft.commitment)
    if (!commitmentHex.startsWith('05')) break
    if (parseWNCommitment(commitmentHex).drawRound !== round) break

    // prevOutput 仍是同一輪的 WN NFT，代表這筆是兌獎交易的原樣送回，繼續往前追
    txid = prevTxid
    decoded = prevDecoded as DecodedTx
  }

  return { txid, decoded }
}

export async function fetchDrawTrail(round: number): Promise<DrawTrail> {
  const cfg = getConfig()

  const result: DrawTrail = {
    round,
    found: false,
    drawTxid: null,
    enterDrawingPhaseTxid: null,
    aggregateTxids: { batchA: null, batchB: null },
    settleTxids: new Array(cfg.shardCount).fill(null),
    drawTimeSecs: null,
  }

  // Step 4（起點）：在 FixedPrizePool 合約地址找到目標輪次的 WinningNumberNFT UTXO。
  // draw() 的 Output[0] 就是這個 WN NFT（送至 FPP，minting capability），但如果已經有人
  // 兌過獎，目前查到的 UTXO 會是最新一筆兌獎交易的原樣送回，須用 resolveDrawTx() 沿著
  // Input[1] 往回追到真正鑄造 WN NFT 的那筆 draw() 交易，不能直接當作 draw() 的 txid。
  const wnUtxo = await fetchWNAtFPPForRound(round)
  if (!wnUtxo) return result

  const resolved = await resolveDrawTx(wnUtxo.txid, round)
  if (!resolved) return result
  result.drawTxid = resolved.txid
  result.found = true
  const drawDecoded = resolved.decoded

  // Step 3：draw() Input[0]（DrawingNFT）的前手交易 = enterDrawingPhase()
  const enterDPTxid = binToHex(drawDecoded.inputs[0].outpointTransactionHash)
  result.enterDrawingPhaseTxid = enterDPTxid
  const enterDPDecoded = await getRawTx(enterDPTxid)
  if (!enterDPDecoded || !enterDPDecoded.inputs[1]) return result

  // 解析 enterDrawingPhase 交易 Output[4]（新產生的 DrawingNFT，purpose 0x04）
  // 取出 expectedDrawTime（開獎時間），用於產生 oracle API 查詢連結
  const drawingNftOutput = enterDPDecoded.outputs[4]
  if (drawingNftOutput?.token?.nft) {
    const commitmentHex = binToHex(drawingNftOutput.token.nft.commitment)
    if (commitmentHex.startsWith('04') && commitmentHex.length >= 22) {
      // DrawingNFT commitment: [0] purpose(1B) [1-2] round(2B) [3-10] expectedDrawTime(8B LE)
      result.drawTimeSecs = Number(leHexToBigInt(commitmentHex.slice(6, 22)))
    }
  }

  // Step 2：enterDrawingPhase() Input[1]（RSC NFT）的前手交易 = aggregate() 第二批（batch B）。
  // aggregate() 現在分兩批各 cfg.shardCount/2 片執行（見 scripts/aggregate.ts），batch B 的
  // Input[0]（RSC NFT）的前手交易才是 batch A——兩批合起來才涵蓋全部分片。
  const batchBTxid = binToHex(enterDPDecoded.inputs[1].outpointTransactionHash)
  result.aggregateTxids.batchB = batchBTxid
  const batchBDecoded = await getRawTx(batchBTxid)
  if (!batchBDecoded) return result

  const batchATxid = binToHex(batchBDecoded.inputs[0].outpointTransactionHash)
  result.aggregateTxids.batchA = batchATxid
  const batchADecoded = await getRawTx(batchATxid)

  // Step 1：兩批 aggregate() 各自 Input[1..batchSize]（合計 cfg.shardCount 張 ShardSettlementNFT）
  // 的前手交易 = 該分片的 settle()。哪個 input 對應哪個 shardId 不能只看 input 順序，改為解出
  // 每筆前手交易自己輸出的 SS commitment（purpose 0x09）讀出真正的 shardId 來對應。
  const batchSize = cfg.shardCount / 2
  const shardInputs = [
    ...(batchADecoded ? batchADecoded.inputs.slice(1, 1 + batchSize) : []),
    ...batchBDecoded.inputs.slice(1, 1 + batchSize),
  ]
  await Promise.all(shardInputs.map(async input => {
    const settleTxid = binToHex(input.outpointTransactionHash)
    const settleDecoded = await getRawTx(settleTxid)
    if (!settleDecoded) return
    const ssOutput = settleDecoded.outputs.find(o =>
      o.token?.nft &&
      binToHex(o.token.category) === cfg.authNftCategoryId &&
      binToHex(o.token.nft.commitment).startsWith('09')
    )
    if (!ssOutput?.token?.nft) return
    const shardId = parseSSCommitment(binToHex(ssOutput.token.nft.commitment)).shardId
    if (shardId >= 0 && shardId < result.settleTxids.length) {
      result.settleTxids[shardId] = settleTxid
    }
  }))

  return result
}

// ─── Broadcast signed transaction ────────────────────────────────────────────

/**
 * Broadcast a signed transaction hex. Returns txid.
 * Throws on failure (caller should wrap in BroadcastError).
 */
export async function broadcastTransaction(signedTxHex: string): Promise<string> {
  return withConnectionErrorTranslation(() => provider.sendRawTransaction(signedTxHex))
}

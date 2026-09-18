// Re-export NFT state types from nftDecode for convenience
export type {
  RSANftState,
  SSNftState,
  NSNftState,
  RSCNftState,
  DrawingNftState,
  WNNftState,
  JPNftState,
  TicketNftState,
  DonationMessageNftState,
  ConfigNftState,
  CRNftState,
} from '@/lib/nftDecode'

// ─── UTXO ────────────────────────────────────────────────────────────────────

export interface Utxo {
  txid: string
  vout: number
  valueSats: bigint
  token?: {
    category: string
    nft?: {
      capability: 'none' | 'mutable' | 'minting'
      commitment: string // hex
    }
    amount?: bigint
  }
}

// ─── Prize level ─────────────────────────────────────────────────────────────

export type PrizeLevel =
  | 'jackpot'  // 3 normal + 1 special
  | 'fixed4'   // 3 normal (no special)  100x ticket price
  | 'fixed3'   // 2 normal + 1 special    20x ticket price
  | 'fixed2'   // 1 normal + 1 special     5x ticket price
  | 'fixed1'   // special only             2x ticket price
  | 'none'

// ─── Parsed ticket (combines NFT state + prize result) ───────────────────────

import type { TicketNftState } from '@/lib/nftDecode'

export interface ParsedTicket extends TicketNftState {
  utxo: Utxo
  /** null = draw not yet happened for this round */
  prizeLevel: PrizeLevel | null
}

// ─── RSA shard UTXO with decoded state ───────────────────────────────────────

import type { RSANftState } from '@/lib/nftDecode'

export interface RsaShardUtxo extends Utxo {
  shardState: RSANftState
}

// ─── SS (ShardSettlement) shard UTXO with decoded state ──────────────────────

import type { SSNftState } from '@/lib/nftDecode'

export interface SsShardUtxo extends Utxo {
  ssState: SSNftState
}

// ─── NumberSales UTXO with decoded state ─────────────────────────────────────

import type { NSNftState } from '@/lib/nftDecode'

export interface NsUtxo extends Utxo {
  nsState: NSNftState
}

// ─── Wallet connection status ─────────────────────────────────────────────────

export type WalletConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'

// ─── Transaction state (shared by all composables) ───────────────────────────

export interface TxState {
  status: 'idle' | 'building' | 'awaiting_signature' | 'broadcasting' | 'retrying' | 'verifying' | 'success' | 'error'
  txid: string | null
  error: string | null
  /** 0 = 非重試中；N = 目前正在第 N 次自動重試（僅購票流程使用，見 lib/broadcastRetry.ts） */
  retryAttempt?: number
}

// ─── Oracle message ───────────────────────────────────────────────────────────

export interface OracleMessage {
  message: string    // 16 bytes hex
  signature: string  // 64 bytes hex
}

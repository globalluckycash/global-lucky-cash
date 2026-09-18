/**
 * walletErrors.ts — error classes for wallet operations, consumed generically by
 * composables via walletBridge.ts.
 */

import { i18n } from '@/i18n'

export class NotConnectedError extends Error {
  constructor() { super(i18n.global.t('errors.wallet_required')) }
}

export class UserRejectedError extends Error {
  constructor(message?: string) { super(message ?? i18n.global.t('toast.tx_cancelled')) }
}

export class BroadcastError extends Error {
  constructor(message: string) { super(message) }
}

/**
 * 簽名請求逾時、或 WalletConnect relay 連線中斷造成的任何非「使用者明確拒絕」例外
 * （見 walletconnect.ts requestSignature() 的錯誤分類）。跟 UserRejectedError 分開，
 * 讓呼叫端（composable）可以判斷是否要啟動「查證交易是否其實已在鏈上成功」的流程，
 * 而不是直接判定為玩家拒絕。訊息本身已經是正確語言，composable 端沿用既有的
 * `err.message` 顯示邏輯即可，不需要額外處理。
 */
export class SignatureConnectionLostError extends Error {
  constructor(message?: string) { super(message ?? i18n.global.t('errors.wallet_connection_lost')) }
}

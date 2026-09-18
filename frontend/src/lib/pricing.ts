/**
 * pricing.ts — 票價與匯率換算共用常數
 * Browser port of scripts/utils/pricing.ts
 */

export const ATTESTATION_SCALING = 100

// 每張票的售價（USD 分），由部署環境決定（見 .env.development / .env.staging / .env.production
// 的 VITE_TICKET_PRICE_USD_CENTS），須與該環境實際創世時合約 constructor 帶入的值一致
export const TICKET_PRICE_USD_CENTS = parseInt(import.meta.env.VITE_TICKET_PRICE_USD_CENTS ?? '100', 10)

// usdCents 換算成「已放大 100 倍的 oracle rate」下對應的 satoshis
export function usdCentsToSats(usdCents: number, attestationScaledRate: number | bigint): bigint {
  return (BigInt(usdCents) * 100_000_000n) / BigInt(attestationScaledRate)
}

export function oneUsdSats(attestationScaledRate: number | bigint): bigint {
  return usdCentsToSats(100, attestationScaledRate)
}

export function ticketPriceSats(attestationScaledRate: number | bigint): bigint {
  return usdCentsToSats(TICKET_PRICE_USD_CENTS, attestationScaledRate)
}

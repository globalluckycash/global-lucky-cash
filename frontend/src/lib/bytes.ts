/**
 * bytes.ts — LE/BE hex conversion utilities (browser-safe, no Node.js Buffer)
 */

export function beHex(value: number | bigint, byteLength: number): string {
  const bigVal = typeof value === 'bigint' ? value : BigInt(value)
  let hex = bigVal.toString(16)
  if (hex.length % 2 !== 0) hex = '0' + hex
  const src = hexToBin(hex)
  const be = new Uint8Array(byteLength)
  be.set(src, byteLength - src.length)
  return binToHex(be)
}

export function leHex(value: number | bigint, byteLength: number): string {
  const bigVal = typeof value === 'bigint' ? value : BigInt(value)
  let hex = bigVal.toString(16)
  if (hex.length % 2 !== 0) hex = '0' + hex
  const bytes = hexToBin(hex).reverse()
  const le = new Uint8Array(byteLength)
  le.set(bytes.slice(0, Math.min(bytes.length, byteLength)))
  return binToHex(le)
}

export function leHexToBigInt(hex: string): bigint {
  if (hex.length === 0) return 0n
  const bytes = hexToBin(hex)
  const reversed = new Uint8Array(bytes).reverse()
  return BigInt('0x' + binToHex(reversed))
}

export function leHexToNumber(hex: string): number {
  return Number(leHexToBigInt(hex))
}

export function hexReverse(hexString: string): string {
  const bytes = hexToBin(hexString)
  return binToHex(new Uint8Array(bytes).reverse())
}

export function hexToBin(hex: string): Uint8Array {
  const len = hex.length / 2
  const result = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    result[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return result
}

export function binToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

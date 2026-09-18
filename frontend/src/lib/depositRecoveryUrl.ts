/**
 * depositRecoveryUrl.ts — encodes/decodes a TicketDeposit order's recovery parameters
 * (round + lotteryNumbers + buyerPkh) into a URL query param.
 *
 * A TicketDeposit address is a P2SH hash of these exact values (see
 * contractConfig.ts's buildTicketDepositPreimage/createTicketDepositContract) and can't be
 * reversed from the address or an on-chain tx alone. Since this purchase flow is wallet-free
 * and backend-free by design, the URL itself (bookmark/history/shared link) is the only place
 * that can carry "what do I need to rebuild this order" across a closed tab or reload.
 *
 * Plaintext, not a hash, is stored deliberately: a hash could only ever support a refund,
 * while the plaintext also lets the player resume and complete the purchase. This leaks no new
 * capability — buyTicket()/refund() are unsigned permissionless covenants keyed to the same
 * commitment already baked into the address, so anyone with the plaintext can only do what the
 * address already commits to.
 */
import { leHex, leHexToNumber, hexToBin, binToHex } from './bytes'

export interface DepositRecoveryParams {
  round: number
  lotteryNumbers: string[]  // 8 hex chars each (n1 n2 n3 s), 1..10 entries
  buyerPkh: Uint8Array       // 20 bytes
}

const ROUND_BYTES = 2
const NUMBER_BYTES = 4
const PKH_BYTES = 20

export function encodeDepositParam(params: DepositRecoveryParams): string {
  const roundHex = leHex(params.round, ROUND_BYTES)
  const numbersHex = params.lotteryNumbers.join('')
  const pkhHex = binToHex(params.buyerPkh)
  return base64UrlEncode(hexToBin(roundHex + numbersHex + pkhHex))
}

export function decodeDepositParam(param: string): DepositRecoveryParams | null {
  let bytes: Uint8Array
  try {
    bytes = base64UrlDecode(param)
  } catch {
    return null
  }

  const numbersLength = bytes.length - ROUND_BYTES - PKH_BYTES
  if (numbersLength < NUMBER_BYTES || numbersLength > NUMBER_BYTES * 10 || numbersLength % NUMBER_BYTES !== 0) {
    return null
  }

  const hex = binToHex(bytes)
  const round = leHexToNumber(hex.slice(0, ROUND_BYTES * 2))
  const numbersHex = hex.slice(ROUND_BYTES * 2, ROUND_BYTES * 2 + numbersLength * 2)
  const lotteryNumbers: string[] = []
  for (let i = 0; i < numbersHex.length; i += NUMBER_BYTES * 2) {
    lotteryNumbers.push(numbersHex.slice(i, i + NUMBER_BYTES * 2))
  }
  const buyerPkh = hexToBin(hex.slice(ROUND_BYTES * 2 + numbersLength * 2))

  return { round, lotteryNumbers, buyerPkh }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * oracle.ts — oracles.generalprotocols.com price feed fetcher
 */

import type { OracleMessage } from '@/types'
import { leHexToNumber } from './bytes'

const ORACLE_API = 'https://oracles.generalprotocols.com/api/v1/oracleMessages'
const ORACLE_PUB = import.meta.env.VITE_ORACLE_PUB as string

export class OracleDataUnavailableError extends Error {
  constructor(reason: string) { super(`Oracle data unavailable: ${reason}`) }
}

interface RawOracleEntry {
  message: string
  signature: string
  publicKey: string
}

interface ParsedMsg {
  messageTimestamp: number
  messageSequence: number
  dataSequence: number
  dataContent: number   // = next round rate (LE uint32)
  raw: OracleMessage
}

function parseMessage(entry: RawOracleEntry): ParsedMsg {
  const msg = entry.message
  // message = 16 bytes hex, little-endian fields
  return {
    messageTimestamp: leHexToNumber(msg.slice(0, 8)),
    messageSequence:  leHexToNumber(msg.slice(8, 16)),
    dataSequence:     leHexToNumber(msg.slice(16, 24)),
    dataContent:      leHexToNumber(msg.slice(24, 32)),
    // Oracle API returns variable-length hex (leading zero bytes stripped); OP_CHECKDATASIG
    // needs a full 64-byte Schnorr signature, so left-pad here — mirrors
    // scripts/draw.ts's queryOracleMessages()/doDraw() padStart(128, '0') handling.
    raw: { message: entry.message, signature: entry.signature.padStart(128, '0') },
  }
}

/**
 * Fetches two consecutive oracle messages suitable for draw():
 *   msg1.messageTimestamp < expectedDrawTime
 *   msg2.messageTimestamp >= expectedDrawTime
 *   msg2.messageSequence == msg1.messageSequence + 1
 */
export async function fetchOracleMessages(expectedDrawTime: bigint): Promise<OracleMessage[]> {
  // Without maxMessageTimestamp, the API only returns its most recent ~50 messages
  // (relative to now), which won't span expectedDrawTime once the operator is more than
  // ~50 minutes late executing the draw. Anchor the query to expectedDrawTime instead,
  // mirroring scripts/draw.ts's queryOracleMessages().
  const maxTs = (expectedDrawTime + 300n).toString()
  const params = new URLSearchParams({ publicKey: ORACLE_PUB, maxMessageTimestamp: maxTs, count: '10' })
  const url = `${ORACLE_API}?${params}`
  const resp = await fetch(url)
  if (!resp.ok) throw new OracleDataUnavailableError(`HTTP ${resp.status}`)

  const { oracleMessages }: { oracleMessages: RawOracleEntry[] } = await resp.json()
  // Price messages only (16 bytes = 32 hex chars); the API can also return other message
  // types mixed in, matching scripts/draw.ts's queryOracleMessages() length filter.
  const messages = oracleMessages
    .filter(entry => entry.message.length === 32)
    .map(parseMessage)
    .sort((a, b) => a.messageSequence - b.messageSequence)

  const drawTime = Number(expectedDrawTime)

  for (let i = 0; i < messages.length - 1; i++) {
    const m1 = messages[i]
    const m2 = messages[i + 1]
    if (
      m1.messageTimestamp < drawTime &&
      m2.messageTimestamp >= drawTime &&
      m2.messageSequence === m1.messageSequence + 1
    ) {
      return [m1.raw, m2.raw]
    }
  }

  throw new OracleDataUnavailableError(
    'No consecutive pair spanning expectedDrawTime found. Draw time may not have arrived yet.'
  )
}

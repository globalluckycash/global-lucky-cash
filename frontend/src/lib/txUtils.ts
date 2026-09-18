import type { TransactionBuilder } from 'cashscript'
import type { Utxo } from '@/types'
import type { WcSourceOutput } from '@bch-wc2/interfaces'

/** Convert our Utxo type (valueSats) to cashscript's Utxo type (satoshis). */
export function toCsUtxo(u: Utxo) {
  return {
    txid: u.txid,
    vout: u.vout,
    satoshis: u.valueSats,
    token: u.token
      ? { category: u.token.category, amount: u.token.amount ?? 0n, nft: u.token.nft }
      : undefined,
  }
}

/**
 * Build a WcSourceOutput entry for a WalletConnect signTransaction request.
 * lockingBytecodeHex: hex string of the locking bytecode (from Contract.lockingBytecode
 * or getLockingBytecodeHex()).
 *
 * WcSourceOutput's TS type (`Input & Output` from @bch-wc2/interfaces) reuses libauth's
 * native shape — bigint amounts, Uint8Array byte fields — but this object is relayed as
 * JSON, and JSON.stringify throws on bigint. Every byte field must be a plain hex string
 * and every amount a decimal string instead. Hence the `as unknown as WcSourceOutput`
 * cast below — the object's runtime shape intentionally doesn't match the declared
 * (native-typed) interface.
 */
export function toSourceOutput(u: Utxo, lockingBytecodeHex: string): WcSourceOutput {
  return {
    // Input fields (required by libauth Input type)
    unlockingBytecode: '',  // P2PKH: leave empty; contract inputs filled by cashscript
    sequenceNumber: 0xffffffff,
    outpointTransactionHash: u.txid,
    outpointIndex: u.vout,
    // Output fields (required by libauth Output type)
    valueSatoshis: u.valueSats.toString(),
    lockingBytecode: lockingBytecodeHex,
    token: u.token
      ? {
          category: u.token.category,
          nft: u.token.nft
            ? {
                capability: u.token.nft.capability as 'none' | 'mutable' | 'minting',
                commitment: u.token.nft.commitment,
              }
            : undefined,
          amount: (u.token.amount ?? 0n).toString(),
        }
      : undefined,
  } as unknown as WcSourceOutput
}

/**
 * A real P2PKH unlock a wallet fills in (push-sig + push-pubkey) is ~108 bytes
 * (up to 72-byte DER/Schnorr sig+sighash, plus 33-byte compressed pubkey, plus two push opcodes).
 */
const P2PKH_UNLOCK_BYTES = 108n

/**
 * Corrects a `feeRate` for `placeholderP2PKHUnlocker`'s `generateUnlockingBytecode()` returning
 * an *empty* (0-byte) script for fee-estimation purposes, instead of the ~108 bytes a real
 * signature+pubkey will occupy once the wallet signs it. Left uncorrected, `feeRate` is
 * computed against a transaction smaller than what actually gets broadcast, so a change/reward
 * output sized off it eats into what should have been fee — the final signed tx ends up under
 * BCH's ~1 sat/byte minimum relay fee and is rejected with "min relay fee not met" (code 66).
 *
 * @param placeholderInputCount - number of inputs on `txBuilder` using `placeholderP2PKHUnlocker`
 *   (i.e. signed remotely by the wallet, not by a contract unlocker already in its final form).
 */
export function correctedFeeRateForWc(
  txBuilder: TransactionBuilder,
  feeRate: number,
  placeholderInputCount: number,
): number {
  const estimatedSize = txBuilder.getTransactionSize()
  if (estimatedSize === 0n || placeholderInputCount === 0) return feeRate
  const shortfall = P2PKH_UNLOCK_BYTES * BigInt(placeholderInputCount)
  return feeRate * (Number(estimatedSize + shortfall) / Number(estimatedSize))
}

/**
 * Wraps `TransactionBuilder.addBchChangeOutputIfNeeded()` with the placeholder-unlocker fee-rate
 * correction above. Should be called *after* all other explicit outputs are added, since it
 * appends the change output last.
 *
 * @param placeholderInputCount - see `correctedFeeRateForWc`.
 */
export function addBchChangeOutputForWc(
  txBuilder: TransactionBuilder,
  options: { to: string; feeRate: number },
  placeholderInputCount: number,
): TransactionBuilder {
  const correctedFeeRate = correctedFeeRateForWc(txBuilder, options.feeRate, placeholderInputCount)
  return txBuilder.addBchChangeOutputIfNeeded({ ...options, feeRate: correctedFeeRate })
}

/**
 * Estimates the miner fee (sats) for `txBuilder` in its *current, final* state — i.e. after every
 * output (including a same-length placeholder for whichever output's exact value is still being
 * solved for) has already been added. Unlike `addBchChangeOutputForWc`, this doesn't append an
 * output; it just prices the transaction as it stands, corrected for placeholder unlockers.
 * Satoshi amounts serialize as a fixed 8 bytes regardless of value, so a placeholder
 * amount doesn't skew the size estimate — only the output's position needs to already be final.
 */
export function estimateFeeForWc(
  txBuilder: TransactionBuilder,
  feeRate: number,
  placeholderInputCount: number,
): bigint {
  const correctedFeeRate = correctedFeeRateForWc(txBuilder, feeRate, placeholderInputCount)
  return BigInt(Math.ceil(correctedFeeRate * Number(txBuilder.getTransactionSize())))
}

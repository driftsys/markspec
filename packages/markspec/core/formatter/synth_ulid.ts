/**
 * @module core/formatter/synth_ulid
 *
 * Deterministic synthesized-ULID derivation per spec §3.5:
 *
 *   ULID(timestamp=0, randomness=truncate(SHA-256(canonical(Source)), 80))
 *
 * Used by the formatter when an Authored entry carries `Origin:
 * synthesized` — the ULID becomes a content-addressed fingerprint of the
 * source pointer, so re-running `fmt` against an already-synthesized
 * entry reproduces the same `Id:`. Authored (default) origin keeps using
 * a fresh random ULID.
 *
 * Uses `node:crypto` rather than Web Crypto so the function stays
 * synchronous; the formatter's public API is sync and threading async
 * through every call site would be a much larger change for no benefit
 * (the hash is bounded by a single short string).
 */

import { createHash } from "node:crypto";

/** Crockford base32 alphabet (no I, L, O, U). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Timestamp half of a `ULID(timestamp=0)` — 10 zero chars. */
const ZERO_TIMESTAMP = "0000000000";

/**
 * Canonicalize a `Source:` value before hashing.
 *
 * Currently: trim leading/trailing whitespace. The canonical form is
 * intentionally minimal — `Source:` is already author-typed and not
 * subject to encoding ambiguity beyond stray surrounding whitespace
 * that the parser may not have stripped (e.g. trailing `\n` from
 * line-joined trailers).
 */
function canonical(source: string): string {
  return source.trim();
}

/**
 * Encode an 80-bit (10-byte) buffer as a 16-char Crockford base32
 * string. Bit order matches the ULID spec (most-significant bit first
 * in the output). Each Crockford symbol carries 5 bits; 80 / 5 = 16.
 */
function encodeBase32_80(bytes: Uint8Array): string {
  if (bytes.length !== 10) {
    throw new Error(
      `expected 10 bytes for 80-bit encoding, got ${bytes.length}`,
    );
  }
  // Accumulate bits into a buffer and pull 5 at a time, MSB-first.
  let bits = 0n;
  for (const b of bytes) {
    bits = (bits << 8n) | BigInt(b);
  }
  let out = "";
  for (let i = 15; i >= 0; i--) {
    const shift = BigInt(i * 5);
    const idx = Number((bits >> shift) & 0x1fn);
    out += CROCKFORD[idx];
  }
  return out;
}

/** Derive a deterministic ULID from a `Source:` value. */
export function synthesizedUlid(source: string): string {
  const canonicalSource = canonical(source);
  const hash = createHash("sha256").update(canonicalSource, "utf8").digest();
  const truncated = new Uint8Array(hash.buffer, hash.byteOffset, 10);
  return ZERO_TIMESTAMP + encodeBase32_80(truncated);
}

/**
 * @module core/lock/hash
 *
 * sha256:* hashing helpers. Uses Web Crypto (works in both Deno and
 * Node.js). Returns a `sha256:<hex>` string matching the lockfile
 * format convention.
 */

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0xf];
  return out;
}

/** Hash bytes → `sha256:<hex>` string. */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so the argument satisfies the strict
  // BufferSource overload (Uint8Array<ArrayBufferLike> includes
  // SharedArrayBuffer which Web Crypto does not accept).
  // Slice only the viewed portion — bytes.buffer may be a larger backing store
  // when bytes is a sub-buffer view. The copy also satisfies the strict
  // BufferSource overload (excludes SharedArrayBuffer).
  const plain = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  const buf = await crypto.subtle.digest(
    "SHA-256",
    plain as Uint8Array<ArrayBuffer>,
  );
  return "sha256:" + toHex(new Uint8Array(buf));
}

/** Hash UTF-8 of a string → `sha256:<hex>` string. */
export async function sha256String(s: string): Promise<string> {
  return await sha256Bytes(new TextEncoder().encode(s));
}

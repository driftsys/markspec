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
  const plain: ArrayBuffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : new Uint8Array(bytes).buffer;
  const buf = await crypto.subtle.digest("SHA-256", plain);
  return "sha256:" + toHex(new Uint8Array(buf));
}

/** Hash UTF-8 of a string → `sha256:<hex>` string. */
export async function sha256String(s: string): Promise<string> {
  return await sha256Bytes(new TextEncoder().encode(s));
}

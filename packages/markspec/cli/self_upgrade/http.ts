/**
 * @module cli/self_upgrade/http
 *
 * HTTP + filesystem helpers for the self-upgrade orchestrator.
 *
 *   - fetchLatestTag: GET <apiBase>/latest → tag_name string.
 *   - downloadTo:     stream a URL body to a file path.
 *   - fetchChecksum:  GET a URL, parse the single-line .sha256 file
 *                     using the shared parseSha256Line from core.
 *   - sha256OfFile:   hex-digest of a file's contents via Web Crypto.
 *
 * All functions throw `Error` with the URL + HTTP status (or underlying
 * network message) in the message so the orchestrator's catch-and-report
 * layer can surface it verbatim.
 */

import { encodeHex } from "@std/encoding/hex";
import { parseSha256Line } from "../../core/self_upgrade/manifest.ts";

/** GET <apiBase>/latest and return the `tag_name` field. */
export async function fetchLatestTag(apiBase: string): Promise<string> {
  const url = `${apiBase}/latest`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/vnd.github+json" },
    });
  } catch (err) {
    throw new Error(`failed to reach ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`failed to fetch ${url}: status ${res.status}`);
  }
  const json = await res.json() as { tag_name?: unknown };
  if (typeof json.tag_name !== "string") {
    throw new Error(`malformed response from ${url}: no tag_name string`);
  }
  return json.tag_name;
}

/** Download the URL body to `path`. Throws on non-2xx. */
export async function downloadTo(url: string, path: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`failed to reach ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`failed to download ${url}: status ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`failed to download ${url}: empty response body`);
  }
  const file = await Deno.open(path, {
    write: true,
    create: true,
    truncate: true,
  });
  try {
    await res.body.pipeTo(file.writable);
  } finally {
    try {
      file.close();
    } catch {
      /* already closed by pipeTo */
    }
  }
}

/** Fetch a .sha256 URL and return the lowercase hex digest. */
export async function fetchChecksum(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`failed to reach ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`failed to fetch checksum ${url}: status ${res.status}`);
  }
  const text = await res.text();
  return parseSha256Line(text);
}

/** SHA-256 hex digest of a file's contents using Web Crypto. */
export async function sha256OfFile(path: string): Promise<string> {
  const data = await Deno.readFile(path);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(new Uint8Array(buf));
}

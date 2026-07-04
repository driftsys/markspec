/**
 * @module compiler/deserialize
 *
 * Hydration of compiled-JSON snapshots back into core {@linkcode Entry}
 * values — the inverse of `./schema.ts`. Consumed by the upstream corpus
 * loader (`core/upstream/`): a dependency's or reference's published
 * compile output is deserialized here before joining the consumer's graph.
 *
 * Pure module: no I/O, no Deno APIs.
 */

import type { Entry } from "../model/mod.ts";
import type { SerializedEntry } from "./schema.ts";

/**
 * Rebuild an {@linkcode Entry} from its serialized wire form. Inverse of
 * `serializeEntry`: restores `typedAttributes` from a plain record to a
 * `Map` (absent → empty). All other fields — including `origin` — pass
 * through verbatim.
 *
 * `type` is re-keyed explicitly (rather than left to the `...rest`
 * spread) to restore field-presence parity with a freshly parsed
 * {@linkcode Entry}: the parser always includes `type` as an own
 * property (`undefined` when no profile classified the entry), but
 * `JSON.stringify` drops `undefined`-valued keys entirely, so the wire
 * form loses the key when it round-trips through `JSON.parse`. Without
 * this, `deserializeEntry(wire)` would be missing the `type` key while
 * the original entry still carries it (with value `undefined`),
 * breaking the deep-equality round-trip contract.
 */
export function deserializeEntry(s: SerializedEntry): Entry {
  const { typedAttributes, type, ...rest } = s;
  return {
    ...rest,
    type,
    typedAttributes: new Map(Object.entries(typedAttributes ?? {})),
  } as Entry;
}

/**
 * @module lsp/id_reservations
 *
 * Short-lived, in-memory reservation set for display-ID numbers handed
 * out by the scaffold-completion resolve handler but not yet observed in
 * the parsed workspace index.
 *
 * ## Why this exists
 *
 * The per-file parse that feeds {@linkcode WorkspaceIndex} is debounced
 * (50 ms) and asynchronous, so the index lags the document. When an
 * author accepts a scaffold completion, the inserted entry does not reach
 * `byDisplayId` until the next parse fires. If a second scaffold accept
 * lands inside that window, both `completionItem/resolve` calls invoke
 * `getNextFreeDisplayIdNumber`, both observe the same indexed maximum, and
 * both mint the *same* display ID — a duplicate the validator flags on
 * the following debounce.
 *
 * This is a *staleness* race, not an event-loop concurrency race: the
 * resolve handler is synchronous, so two resolves serialize, but neither
 * sees the other's freshly-inserted entry because the parse has not yet
 * run. {@linkcode reserve} records a number the instant resolve hands it
 * out so the next resolve skips it; {@linkcode release} is called once a
 * parse observes the entry in the index.
 *
 * A number reservation is keyed by the `(prefix, suffix)` of the scaffold
 * that minted it. {@linkcode mintReservedNumber} also records the formatted
 * display ID, because two keys can format the same ID: with nothing between
 * `{scope}` and the counter (`G_{scope}{n:02d}`), number 101 of scope `BR`
 * (prefix `G_BR`) and number 1 of scope `BR1` (prefix `G_BR1`) are both
 * `G_BR101`. The resolve handler rejects a display ID that
 * {@linkcode isDisplayIdReserved} reports (#1041), and
 * {@linkcode releaseDisplayId} drops the ID together with the number
 * reservation that minted it. Each mint also drops every display-ID
 * reservation past its TTL, so the IDs of abandoned resolves (a client
 * can resolve an item it never inserts) do not accumulate.
 *
 * Reservations live for the LSP process lifetime only — on restart the
 * parsed index is authoritative again. A {@linkcode RESERVATION_TTL_MS}
 * timeout drops reservations for completions abandoned mid-accept so a
 * number is never blocked forever.
 */

/** Reservations older than this are evicted lazily on read. */
const RESERVATION_TTL_MS = 60_000;

/**
 * Bucket key for a `(prefix, suffix)` pair. The NUL separator can never
 * appear in a display-ID prefix or suffix, so it unambiguously joins the
 * two halves without collisions (e.g. `("A_", "B")` vs `("A", "_B")`).
 */
function keyOf(prefix: string, suffix: string): string {
  return `${prefix}\0${suffix}`;
}

/** key → (reserved number → reservation timestamp in ms). */
const reservations = new Map<string, Map<number, number>>();

/** One reservation by formatted display ID: the number reservation that
 * minted it, and when. */
interface DisplayIdReservation {
  readonly prefix: string;
  readonly suffix: string;
  readonly n: number;
  readonly ts: number;
}

/** Formatted display ID → the reservation that minted it. */
const displayIdReservations = new Map<string, DisplayIdReservation>();

/** Shared empty result for the no-bucket case — never mutated. */
const EMPTY: ReadonlySet<number> = new Set<number>();

/** Wall-clock source; overridable in tests via {@linkcode _setNow}. */
let nowFn: () => number = () => Date.now();

/**
 * Drop entries in `bucket` whose reservation is at least
 * {@linkcode RESERVATION_TTL_MS} old. Mutates the bucket in place.
 */
function evictStale(bucket: Map<number, number>, now: number): void {
  for (const [n, ts] of bucket) {
    if (now - ts >= RESERVATION_TTL_MS) bucket.delete(n);
  }
}

/**
 * Record that display-ID `n` (for the given `prefix`/`suffix` pattern)
 * has been handed out. Overwrites the timestamp if `n` was already
 * reserved, refreshing its TTL.
 */
export function reserve(prefix: string, suffix: string, n: number): void {
  const key = keyOf(prefix, suffix);
  let bucket = reservations.get(key);
  if (!bucket) {
    bucket = new Map();
    reservations.set(key, bucket);
  }
  bucket.set(n, nowFn());
}

/**
 * Return `true` when `n` is currently reserved for the given pattern.
 * Evicts stale reservations first, so a number past its TTL reads as
 * not reserved.
 */
export function isReserved(prefix: string, suffix: string, n: number): boolean {
  const bucket = reservations.get(keyOf(prefix, suffix));
  if (!bucket) return false;
  evictStale(bucket, nowFn());
  return bucket.has(n);
}

/**
 * Drop the reservation for `n`. Called once a parse observes the entry
 * in the index. A no-op when `n` was never reserved. Empties the bucket
 * map entry when its last reservation is released so the map does not
 * accumulate empty buckets.
 */
export function release(prefix: string, suffix: string, n: number): void {
  const key = keyOf(prefix, suffix);
  const bucket = reservations.get(key);
  if (!bucket) return;
  bucket.delete(n);
  if (bucket.size === 0) reservations.delete(key);
}

/**
 * Return `true` when `displayId` was minted by {@linkcode mintReservedNumber}
 * under any `(prefix, suffix)` and its reservation is younger than
 * {@linkcode RESERVATION_TTL_MS}. A stale reservation is evicted here.
 */
export function isDisplayIdReserved(displayId: string): boolean {
  const reservation = displayIdReservations.get(displayId);
  if (!reservation) return false;
  if (nowFn() - reservation.ts >= RESERVATION_TTL_MS) {
    displayIdReservations.delete(displayId);
    return false;
  }
  return true;
}

/** Drop every display-ID reservation that is at least
 * {@linkcode RESERVATION_TTL_MS} old. */
function evictStaleDisplayIds(now: number): void {
  for (const [id, reservation] of displayIdReservations) {
    if (now - reservation.ts >= RESERVATION_TTL_MS) {
      displayIdReservations.delete(id);
    }
  }
}

/**
 * Drop the reservation of `displayId`, and the number reservation of the
 * `(prefix, suffix)` that minted it. Called once a parse observes the entry
 * in the index; the number reservation is released even when the observed
 * ID decomposes under another key (`G_BR101` minted for scope `BR` reads as
 * scope `BR1`). A no-op when `displayId` is not reserved.
 */
export function releaseDisplayId(displayId: string): void {
  const reservation = displayIdReservations.get(displayId);
  if (!reservation) return;
  displayIdReservations.delete(displayId);
  release(reservation.prefix, reservation.suffix, reservation.n);
}

/**
 * Return the set of numbers currently reserved for the given pattern.
 * Evicts stale reservations first. The returned set is a fresh copy —
 * callers may not mutate the internal state through it.
 */
export function reservedNumbersFor(
  prefix: string,
  suffix: string,
): ReadonlySet<number> {
  const bucket = reservations.get(keyOf(prefix, suffix));
  if (!bucket) return EMPTY;
  evictStale(bucket, nowFn());
  if (bucket.size === 0) return EMPTY;
  return new Set(bucket.keys());
}

/**
 * Atomically mint and reserve the next display-ID number for a scaffold
 * resolve. Reads the current reservation set, asks `nextFree` for the
 * next number above both the indexed maximum and the reserved set (in
 * `server.ts`, also one whose display ID is neither indexed nor reserved),
 * then reserves it so an immediately-following mint skips it.
 *
 * When `formatId` is given, the formatted display ID of the minted number
 * is reserved too ({@linkcode isDisplayIdReserved}), so a mint under
 * another `(prefix, suffix)` whose `nextFree` rejects reserved IDs never
 * hands out the same display ID. Every call first drops the display-ID
 * reservations past their TTL.
 *
 * The index lookup is injected as a callback rather than imported so this
 * module stays decoupled from {@linkcode WorkspaceIndex}. `server.ts`'s
 * `onCompletionResolve` wraps `index.getNextFreeDisplayIdNumber`; tests can
 * supply a stub that mimics a stale index whose maximum never moves.
 */
export function mintReservedNumber(
  prefix: string,
  suffix: string,
  nextFree: (reserved: ReadonlySet<number>) => number,
  formatId?: (n: number) => string,
): number {
  evictStaleDisplayIds(nowFn());
  const reserved = reservedNumbersFor(prefix, suffix);
  const n = nextFree(reserved);
  reserve(prefix, suffix, n);
  if (formatId) {
    displayIdReservations.set(formatId(n), { prefix, suffix, n, ts: nowFn() });
  }
  return n;
}

/** Test-only: clear every reservation and restore the real wall clock. */
export function _reset(): void {
  reservations.clear();
  displayIdReservations.clear();
  nowFn = () => Date.now();
}

/** Test-only: the number of display-ID reservations held, stale or not. */
export function _displayIdReservationCount(): number {
  return displayIdReservations.size;
}

/** Test-only: override the clock so TTL eviction can be exercised. */
export function _setNow(fn: () => number): void {
  nowFn = fn;
}

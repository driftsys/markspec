/**
 * @module lsp/id_reservations_test
 *
 * Unit tests for the short-lived display-ID reservation set used to
 * close the rapid-scaffold-accept duplicate-ID race.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { IdReservations } from "./id_reservations.ts";
import { WorkspaceIndex } from "./workspace.ts";
import { renderScaffoldSnippet } from "./completions.ts";
import {
  displayIdScopeFilter,
  formatDisplayId,
  makeDisplayId,
} from "../core/mod.ts";
import type { Entry, SourceLocation } from "../core/mod.ts";

/** Formats a number of the `STK_{n:04d}` pattern. */
const stkId = (n: number): string => `STK_${String(n).padStart(4, "0")}`;

Deno.test("id_reservations: reserve then isReserved returns true", () => {
  const r = new IdReservations();
  r.reserve("STK_", "", 5);
  assertEquals(r.isReserved("STK_", "", 5), true);
  assertEquals(r.isReserved("STK_", "", 6), false);
});

Deno.test("id_reservations: unreserved number is not reserved", () => {
  const r = new IdReservations();
  assertEquals(r.isReserved("STK_", "", 1), false);
});

Deno.test("id_reservations: reservations are keyed by (prefix, suffix)", () => {
  const r = new IdReservations();
  r.reserve("STK_", "", 5);
  // Same number under a different prefix is independent.
  assertEquals(r.isReserved("SYS_", "", 5), false);
  // Same prefix but different suffix is independent.
  assertEquals(r.isReserved("STK_", "-draft", 5), false);
  r.reserve("STK_", "-draft", 5);
  assertEquals(r.isReserved("STK_", "-draft", 5), true);
  // Releasing one keying does not touch the other.
  r.release("STK_", "", 5);
  assertEquals(r.isReserved("STK_", "", 5), false);
  assertEquals(r.isReserved("STK_", "-draft", 5), true);
});

Deno.test("id_reservations: release removes a reservation", () => {
  const r = new IdReservations();
  r.reserve("STK_", "", 5);
  r.release("STK_", "", 5);
  assertEquals(r.isReserved("STK_", "", 5), false);
});

Deno.test("id_reservations: release of an unknown number is a no-op", () => {
  const r = new IdReservations();
  r.reserve("STK_", "", 5);
  r.release("STK_", "", 99); // never reserved
  assertEquals(r.isReserved("STK_", "", 5), true);
});

Deno.test("id_reservations: reservedNumbersFor returns the reserved set", () => {
  const r = new IdReservations();
  r.reserve("STK_", "", 5);
  r.reserve("STK_", "", 6);
  const set = r.reservedNumbersFor("STK_", "");
  assertEquals([...set].sort((a, b) => a - b), [5, 6]);
});

Deno.test("id_reservations: reservedNumbersFor is empty for unknown key", () => {
  const r = new IdReservations();
  assertEquals([...r.reservedNumbersFor("NOPE_", "")], []);
});

Deno.test("id_reservations: reservations older than the TTL are evicted", () => {
  let clock = 0;
  const r = new IdReservations(() => clock);
  r.reserve("STK_", "", 5); // reserved at t=0
  clock = 59_999; // just under the 60s TTL
  assertEquals(r.isReserved("STK_", "", 5), true);
  clock = 60_000; // at the TTL boundary → evicted
  assertEquals(r.isReserved("STK_", "", 5), false);
  assertEquals([...r.reservedNumbersFor("STK_", "")], []);
});

Deno.test(
  "id_reservations: two back-to-back mints on the same key yield distinct numbers",
  () => {
    const r = new IdReservations();
    // Simulate the index reporting the same next-free number on both
    // calls (the staleness window: parse hasn't run yet, so the index
    // max never moves). The reservation set must still force the second
    // mint to a different number.
    const nextFree = (reserved: ReadonlySet<number>): number => {
      // Index max is 4 (so bare next-free is 5); reservations bump it.
      let max = 4;
      for (const n of reserved) if (n > max) max = n;
      return max + 1;
    };

    const first = r.mintReservedNumber("STK_", "", nextFree, stkId);
    const second = r.mintReservedNumber("STK_", "", nextFree, stkId);
    assertEquals(first, 5);
    assertEquals(second, 6);
    assertEquals(first === second, false);
  },
);

/** Minimal identified entry for the integration test below. */
function entry(displayId: string): Entry {
  const location: SourceLocation = { file: "reqs.md", line: 1, column: 1 };
  return {
    displayId: makeDisplayId(displayId),
    title: displayId,
    body: "",
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location,
    source: { kind: "markdown" },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
}

Deno.test(
  "id_reservations: two back-to-back resolves against a stale index render distinct display IDs",
  () => {
    const r = new IdReservations();
    // Reproduce the real race: the index holds STK_0001/0002 and does NOT
    // change between the two resolves (the parse that would add the first
    // accept's entry is still debounced). This mirrors exactly what
    // server.ts's onCompletionResolve composes: mintReservedNumber wrapping
    // index.getNextFreeDisplayIdNumber, then renderScaffoldSnippet.
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("STK_0001"), entry("STK_0002")]);
    const shape = { prefix: "STK_", width: 4, suffix: "" };

    const resolveOnce = (): string => {
      const n = r.mintReservedNumber(
        "STK_",
        "",
        (reserved) => index.getNextFreeDisplayIdNumber(shape, reserved),
        (num) => formatDisplayId(shape, num),
      );
      return renderScaffoldSnippet({
        typeName: "StakeholderRequirement",
        prefix: "STK_",
        width: 4,
        suffix: "",
        nextNumber: n,
        ulid: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      }).insertText;
    };

    const firstInsert = resolveOnce();
    const secondInsert = resolveOnce();

    // Each insertText starts with the display ID followed by `]`.
    const firstId = firstInsert.split("]")[0];
    const secondId = secondInsert.split("]")[0];
    assertEquals(firstId, "STK_0003");
    assertEquals(secondId, "STK_0004");
    assertNotEquals(firstId, secondId);
  },
);

Deno.test(
  "id_reservations: resolves for a glued {scope} pattern skip an existing ID and a reserved number (#1041)",
  () => {
    const r = new IdReservations();
    // G_{scope}{n:02d}: G_BR100 reads as scope BR1, so scope BR counts
    // only G_BR99. The composition below is the one server.ts's
    // onCompletionResolve runs for scope BR.
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [
      entry("G_BR99"),
      entry("G_BR100"),
      entry("G_BR102"),
    ]);
    const shape = { prefix: "G_BR", width: 2, suffix: "" };
    const accept = displayIdScopeFilter("G_{scope}{n:02d}", "BR");
    const resolveOnce = (): number =>
      r.mintReservedNumber(
        "G_BR",
        "",
        (reserved) => index.getNextFreeDisplayIdNumber(shape, reserved, accept),
        (num) => formatDisplayId(shape, num),
      );

    // 100 exists (G_BR100): the first resolve takes 101 and reserves it.
    assertEquals(resolveOnce(), 101);
    // 101 is reserved and 102 exists (G_BR102): the second takes 103.
    assertEquals(resolveOnce(), 103);
  },
);

/**
 * One resolve for scope `scope` of `G_{scope}{n:02d}`, composed as
 * server.ts's onCompletionResolve composes it. Returns the minted ID.
 */
function resolveGlued(
  r: IdReservations,
  index: WorkspaceIndex,
  scope: string,
): string {
  const shape = { prefix: `G_${scope}`, width: 2, suffix: "" };
  const accept = displayIdScopeFilter("G_{scope}{n:02d}", scope);
  const n = r.mintReservedNumber(
    shape.prefix,
    shape.suffix,
    (reserved) =>
      index.getNextFreeDisplayIdNumber(
        shape,
        reserved,
        accept,
        (id) => r.isDisplayIdReserved(id),
      ),
    (num) => formatDisplayId(shape, num),
  );
  return formatDisplayId(shape, n);
}

Deno.test(
  "id_reservations: resolves under two glued scopes never mint the same display ID (#1041)",
  () => {
    const r = new IdReservations();
    // Scope BR counts G_BR99 and skips the existing G_BR100: it mints
    // G_BR101 (number 101). Scope BR1 counts G_BR100 (number 00): its next
    // number, 1, also formats to G_BR101, which the first resolve reserved.
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("G_BR99"), entry("G_BR100")]);
    assertEquals(resolveGlued(r, index, "BR"), "G_BR101");
    assertEquals(resolveGlued(r, index, "BR1"), "G_BR102");
    assertEquals(r.isDisplayIdReserved("G_BR101"), true);
    assertEquals(r.isDisplayIdReserved("G_BR102"), true);
  },
);

Deno.test(
  "id_reservations: releaseDisplayId frees the ID and the number reservation that minted it (#1041)",
  () => {
    const r = new IdReservations();
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("G_BR99"), entry("G_BR100")]);
    assertEquals(resolveGlued(r, index, "BR"), "G_BR101");
    assertEquals(r.isReserved("G_BR", "", 101), true);
    // The parse observes G_BR101, which reads as scope BR1: the release by
    // ID still drops the reservation of prefix G_BR.
    r.releaseDisplayId("G_BR101");
    assertEquals(r.isDisplayIdReserved("G_BR101"), false);
    assertEquals(r.isReserved("G_BR", "", 101), false);
    // An unknown ID is a no-op.
    r.releaseDisplayId("G_BR555");
  },
);

Deno.test(
  "id_reservations: a display-ID reservation older than the TTL is evicted (#1041)",
  () => {
    let now = 1_000_000;
    const r = new IdReservations(() => now);
    r.mintReservedNumber("G_BR", "", () => 101, () => "G_BR101");
    assertEquals(r.isDisplayIdReserved("G_BR101"), true);
    now += 60_000;
    assertEquals(r.isDisplayIdReserved("G_BR101"), false);
    // The lookup itself evicted the stale reservation.
    assertEquals(r._displayIdReservationCount(), 0);
  },
);

Deno.test(
  "id_reservations: a later mint drops a stale display-ID reservation that was never looked up (#1041)",
  () => {
    let now = 1_000_000;
    const r = new IdReservations(() => now);
    r.mintReservedNumber("G_BR", "", () => 101, () => "G_BR101");
    assertEquals(r._displayIdReservationCount(), 1);
    now += 60_000;
    // No lookup of G_BR101 happens: the next mint sweeps it.
    r.mintReservedNumber("G_BR", "", () => 102, () => "G_BR102");
    assertEquals(r._displayIdReservationCount(), 1);
    assertEquals(r.isDisplayIdReserved("G_BR102"), true);
  },
);

Deno.test(
  "id_reservations: a release in one project leaves another project's reservation (#1041)",
  () => {
    // Project A minted G_BR101. Project B parses a file that holds G_BR101
    // and releases it in its own reservations: A's reservation must stay,
    // or A's next resolve, before A's own parse, mints G_BR101 again.
    const projectA = new IdReservations();
    const projectB = new IdReservations();
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("G_BR99"), entry("G_BR100")]);
    assertEquals(resolveGlued(projectA, index, "BR"), "G_BR101");
    projectB.releaseDisplayId("G_BR101");
    projectB.release("G_BR", "", 101);
    assertEquals(projectA.isDisplayIdReserved("G_BR101"), true);
    assertEquals(projectA.isReserved("G_BR", "", 101), true);
    assertEquals(resolveGlued(projectA, index, "BR"), "G_BR102");
  },
);

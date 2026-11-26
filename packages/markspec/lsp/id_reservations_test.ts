/**
 * @module lsp/id_reservations_test
 *
 * Unit tests for the short-lived display-ID reservation set used to
 * close the rapid-scaffold-accept duplicate-ID race.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  _displayIdReservationCount,
  _reset,
  _setNow,
  isDisplayIdReserved,
  isReserved,
  mintReservedNumber,
  release,
  releaseDisplayId,
  reserve,
  reservedNumbersFor,
} from "./id_reservations.ts";
import { WorkspaceIndex } from "./workspace.ts";
import { renderScaffoldSnippet } from "./completions.ts";
import {
  displayIdScopeFilter,
  formatDisplayId,
  makeDisplayId,
} from "../core/mod.ts";
import type { Entry, SourceLocation } from "../core/mod.ts";

function teardown() {
  _reset();
}

Deno.test("id_reservations: reserve then isReserved returns true", () => {
  teardown();
  reserve("STK_", "", 5);
  assertEquals(isReserved("STK_", "", 5), true);
  assertEquals(isReserved("STK_", "", 6), false);
});

Deno.test("id_reservations: unreserved number is not reserved", () => {
  teardown();
  assertEquals(isReserved("STK_", "", 1), false);
});

Deno.test("id_reservations: reservations are keyed by (prefix, suffix)", () => {
  teardown();
  reserve("STK_", "", 5);
  // Same number under a different prefix is independent.
  assertEquals(isReserved("SYS_", "", 5), false);
  // Same prefix but different suffix is independent.
  assertEquals(isReserved("STK_", "-draft", 5), false);
  reserve("STK_", "-draft", 5);
  assertEquals(isReserved("STK_", "-draft", 5), true);
  // Releasing one keying does not touch the other.
  release("STK_", "", 5);
  assertEquals(isReserved("STK_", "", 5), false);
  assertEquals(isReserved("STK_", "-draft", 5), true);
});

Deno.test("id_reservations: release removes a reservation", () => {
  teardown();
  reserve("STK_", "", 5);
  release("STK_", "", 5);
  assertEquals(isReserved("STK_", "", 5), false);
});

Deno.test("id_reservations: release of an unknown number is a no-op", () => {
  teardown();
  reserve("STK_", "", 5);
  release("STK_", "", 99); // never reserved
  assertEquals(isReserved("STK_", "", 5), true);
});

Deno.test("id_reservations: reservedNumbersFor returns the reserved set", () => {
  teardown();
  reserve("STK_", "", 5);
  reserve("STK_", "", 6);
  const set = reservedNumbersFor("STK_", "");
  assertEquals([...set].sort((a, b) => a - b), [5, 6]);
});

Deno.test("id_reservations: reservedNumbersFor is empty for unknown key", () => {
  teardown();
  assertEquals([...reservedNumbersFor("NOPE_", "")], []);
});

Deno.test("id_reservations: reservations older than the TTL are evicted", () => {
  teardown();
  let clock = 0;
  _setNow(() => clock);
  reserve("STK_", "", 5); // reserved at t=0
  clock = 59_999; // just under the 60s TTL
  assertEquals(isReserved("STK_", "", 5), true);
  clock = 60_000; // at the TTL boundary → evicted
  assertEquals(isReserved("STK_", "", 5), false);
  assertEquals([...reservedNumbersFor("STK_", "")], []);
});

Deno.test("id_reservations: _reset clears all reservations and the clock", () => {
  teardown();
  const clock = 1_000;
  _setNow(() => clock);
  reserve("STK_", "", 5);
  _reset();
  assertEquals(isReserved("STK_", "", 5), false);
  // After reset the injected clock is gone, so a fresh reservation
  // is live under the real wall clock.
  reserve("STK_", "", 7);
  assertEquals(isReserved("STK_", "", 7), true);
});

Deno.test(
  "id_reservations: two back-to-back mints on the same key yield distinct numbers",
  () => {
    teardown();
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

    const first = mintReservedNumber("STK_", "", nextFree);
    const second = mintReservedNumber("STK_", "", nextFree);
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
    teardown();
    // Reproduce the real race: the index holds STK_0001/0002 and does NOT
    // change between the two resolves (the parse that would add the first
    // accept's entry is still debounced). This mirrors exactly what
    // server.ts's onCompletionResolve composes: mintReservedNumber wrapping
    // index.getNextFreeDisplayIdNumber, then renderScaffoldSnippet.
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("STK_0001"), entry("STK_0002")]);
    const shape = { prefix: "STK_", width: 4, suffix: "" };

    const resolveOnce = (): string => {
      const n = mintReservedNumber(
        "STK_",
        "",
        (reserved) => index.getNextFreeDisplayIdNumber(shape, reserved),
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
    teardown();
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
      mintReservedNumber(
        "G_BR",
        "",
        (reserved) => index.getNextFreeDisplayIdNumber(shape, reserved, accept),
      );

    // 100 exists (G_BR100): the first resolve takes 101 and reserves it.
    assertEquals(resolveOnce(), 101);
    // 101 is reserved and 102 exists (G_BR102): the second takes 103.
    assertEquals(resolveOnce(), 103);
    teardown();
  },
);

/**
 * One resolve for scope `scope` of `G_{scope}{n:02d}`, composed as
 * server.ts's onCompletionResolve composes it. Returns the minted ID.
 */
function resolveGlued(index: WorkspaceIndex, scope: string): string {
  const shape = { prefix: `G_${scope}`, width: 2, suffix: "" };
  const accept = displayIdScopeFilter("G_{scope}{n:02d}", scope);
  const n = mintReservedNumber(
    shape.prefix,
    shape.suffix,
    (reserved) =>
      index.getNextFreeDisplayIdNumber(
        shape,
        reserved,
        accept,
        isDisplayIdReserved,
      ),
    (num) => formatDisplayId(shape, num),
  );
  return formatDisplayId(shape, n);
}

Deno.test(
  "id_reservations: resolves under two glued scopes never mint the same display ID (#1041)",
  () => {
    teardown();
    // Scope BR counts G_BR99 and skips the existing G_BR100: it mints
    // G_BR101 (number 101). Scope BR1 counts G_BR100 (number 00): its next
    // number, 1, also formats to G_BR101, which the first resolve reserved.
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("G_BR99"), entry("G_BR100")]);
    assertEquals(resolveGlued(index, "BR"), "G_BR101");
    assertEquals(resolveGlued(index, "BR1"), "G_BR102");
    assertEquals(isDisplayIdReserved("G_BR101"), true);
    assertEquals(isDisplayIdReserved("G_BR102"), true);
    teardown();
  },
);

Deno.test(
  "id_reservations: releaseDisplayId frees the ID and the number reservation that minted it (#1041)",
  () => {
    teardown();
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("G_BR99"), entry("G_BR100")]);
    assertEquals(resolveGlued(index, "BR"), "G_BR101");
    assertEquals(isReserved("G_BR", "", 101), true);
    // The parse observes G_BR101, which reads as scope BR1: the release by
    // ID still drops the reservation of prefix G_BR.
    releaseDisplayId("G_BR101");
    assertEquals(isDisplayIdReserved("G_BR101"), false);
    assertEquals(isReserved("G_BR", "", 101), false);
    // An unknown ID is a no-op.
    releaseDisplayId("G_BR555");
    teardown();
  },
);

Deno.test(
  "id_reservations: a display-ID reservation older than the TTL is evicted (#1041)",
  () => {
    teardown();
    let now = 1_000_000;
    _setNow(() => now);
    mintReservedNumber("G_BR", "", () => 101, () => "G_BR101");
    assertEquals(isDisplayIdReserved("G_BR101"), true);
    now += 60_000;
    assertEquals(isDisplayIdReserved("G_BR101"), false);
    teardown();
  },
);

Deno.test(
  "id_reservations: a later mint drops a stale display-ID reservation that was never looked up (#1041)",
  () => {
    teardown();
    let now = 1_000_000;
    _setNow(() => now);
    mintReservedNumber("G_BR", "", () => 101, () => "G_BR101");
    assertEquals(_displayIdReservationCount(), 1);
    now += 60_000;
    // No lookup of G_BR101 happens: the next mint sweeps it.
    mintReservedNumber("G_BR", "", () => 102, () => "G_BR102");
    assertEquals(_displayIdReservationCount(), 1);
    assertEquals(isDisplayIdReserved("G_BR102"), true);
    teardown();
  },
);

/**
 * @module lsp/id_reservations_test
 *
 * Unit tests for the short-lived display-ID reservation set used to
 * close the rapid-scaffold-accept duplicate-ID race.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  _reset,
  _setNow,
  isReserved,
  mintReservedNumber,
  release,
  reserve,
  reservedNumbersFor,
} from "./id_reservations.ts";
import { WorkspaceIndex } from "./workspace.ts";
import { renderScaffoldSnippet } from "./completions.ts";
import { makeDisplayId } from "../core/mod.ts";
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
    // index.getNextDisplayIdNumber, then renderScaffoldSnippet.
    const index = new WorkspaceIndex();
    index.updateFile("reqs.md", [entry("STK_0001"), entry("STK_0002")]);

    const resolveOnce = (): string => {
      const n = mintReservedNumber(
        "STK_",
        "",
        (reserved) => index.getNextDisplayIdNumber("STK_", "", reserved),
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

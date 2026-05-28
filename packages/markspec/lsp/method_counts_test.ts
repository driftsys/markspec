import { assertEquals } from "@std/assert";
import { _reset, snapshot, tally } from "./method_counts.ts";

Deno.test("method_counts: tally increments distinct methods", () => {
  _reset();
  tally("completion");
  tally("hover");
  tally("definition");
  const s = snapshot();
  assertEquals(s.get("completion"), 1);
  assertEquals(s.get("hover"), 1);
  assertEquals(s.get("definition"), 1);
  assertEquals(s.size, 3);
});

Deno.test("method_counts: tally accumulates same method", () => {
  _reset();
  tally("completion");
  tally("completion");
  tally("completion");
  const s = snapshot();
  assertEquals(s.get("completion"), 3);
  assertEquals(s.size, 1);
});

Deno.test("method_counts: _reset clears state", () => {
  _reset();
  tally("hover");
  tally("hover");
  _reset();
  const s = snapshot();
  assertEquals(s.size, 0);
  assertEquals(s.get("hover"), undefined);
});

Deno.test("method_counts: unseen method reads undefined", () => {
  _reset();
  const s = snapshot();
  assertEquals(s.get("never-called"), undefined);
});

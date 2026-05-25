import { assertEquals, assertThrows } from "@std/assert";
import { encodeLogLine, parseLogLine, type SyncLogEntry } from "./log.ts";

const E: SyncLogEntry = {
  ts: "2026-05-25T12:00:00Z",
  op: "conflict",
  entryId: "01HGW2Q",
  displayId: "REQ-107",
  externalId: "jira:PROJ-1423",
  direction: "bidirectional",
  attrsChanged: ["Title"],
  remoteStateBefore: "ok",
  remoteStateAfter: "conflict",
  hashBefore: "sha256:abc",
  hashAfter: "sha256:def",
  actor: "alice@example.com",
};

Deno.test("encodeLogLine: produces single-line NDJSON ending in newline", () => {
  const line = encodeLogLine(E);
  assertEquals(line.endsWith("\n"), true);
  assertEquals(line.split("\n").length, 2); // payload + trailing newline
});

Deno.test("encodeLogLine: rejects embedded newlines", () => {
  const bad = { ...E, displayId: "line1\nline2" };
  assertThrows(() => encodeLogLine(bad), Error, "embedded newline");
});

Deno.test("parseLogLine: round-trips a known record", () => {
  const line = encodeLogLine(E);
  const parsed = parseLogLine(line.trim());
  assertEquals(parsed, E);
});

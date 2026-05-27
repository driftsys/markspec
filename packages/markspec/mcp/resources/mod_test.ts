/**
 * @module mcp/resources/mod_test
 *
 * Unit tests for the resources/list and resources/read dispatch.
 *
 * Builds a minimal Project shim and asserts the descriptor list and the
 * routing logic in readResource.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  CompileResult,
  DisplayId,
  Entry,
  ProfileChain,
} from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import type { Project } from "../project.ts";
import { SOFT_GATE_MESSAGE } from "../project.ts";
import { listResourceDescriptors, readResource } from "./mod.ts";

function mkProject(entries: Entry[]): Project {
  const entriesMap = new Map<DisplayId, Entry>();
  for (const e of entries) entriesMap.set(e.displayId, e);
  const result: CompileResult = {
    entries: entriesMap,
    links: [],
    forward: new Map(),
    reverse: new Map(),
    documents: new Map(),
    diagnostics: [],
    typeRegistry: { bindings: new Map(), typedefs: new Map() },
  };
  const chain: ProfileChain | null = null;
  return {
    projectRoot: "/proj",
    markspecDetected: true,
    config: undefined,
    profileChain: chain,
    profile: undefined,
    getCompiled: () => Promise.resolve(result),
    forceRefresh: () => Promise.resolve(result),
    subscribeInvalidation: () => () => {},
  };
}

const E1: Entry = {
  displayId: makeDisplayId("STK_TEST_0001"),
  title: "First entry",
  body: "",
  rawAttributes: [],
  typedAttributes: new Map(),
  shape: "Authored",
  location: { file: "/proj/x.md", line: 1, column: 1 },
  source: { kind: "markdown" },
  bodyTokens: [],
};

Deno.test("listResourceDescriptors: includes profile + entries + per-entry", async () => {
  const project = mkProject([E1]);
  const list = await listResourceDescriptors(project);
  assertEquals(list.length, 3);
  assertEquals(list[0].uri, "markspec://profile");
  assertEquals(list[1].uri, "markspec://entries");
  assertEquals(list[2].uri, "markspec://entry/STK_TEST_0001");
});

Deno.test("readResource: routes profile URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource("markspec://profile", project);
  assertStringIncludes(r.text, "# MarkSpec Profile");
});

Deno.test("readResource: routes entries URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource("markspec://entries", project);
  assertStringIncludes(r.text, "# Entries (1)");
});

Deno.test("readResource: routes entry URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource(
    "markspec://entry/STK_TEST_0001",
    project,
  );
  assertStringIncludes(r.text, "# STK_TEST_0001 — First entry");
});

Deno.test("readResource: rejects unknown URI", async () => {
  const project = mkProject([E1]);
  await assertRejects(
    () => readResource("markspec://unknown", project),
    Error,
    "unknown resource URI",
  );
});

Deno.test("readResource: rejects missing entry", async () => {
  const project = mkProject([E1]);
  await assertRejects(
    () => readResource("markspec://entry/NOPE_0001", project),
    Error,
    "entry not found",
  );
});

function gatedProject(): Project {
  return {
    projectRoot: undefined,
    markspecDetected: false,
    config: undefined,
    profileChain: null,
    profile: undefined,
    getCompiled: () =>
      Promise.reject(new Error("getCompiled must not be called when gated")),
    forceRefresh: () =>
      Promise.reject(new Error("forceRefresh must not be called when gated")),
    subscribeInvalidation: () => () => {},
  };
}

Deno.test("readResource: returns soft-gate text when markspecDetected=false", async () => {
  const project = gatedProject();
  const result = await readResource("markspec://entries", project);
  assertEquals(result.mimeType, "text/plain");
  assertEquals(result.text, SOFT_GATE_MESSAGE);
});

Deno.test("readResource: soft-gate fires for any URI when gated", async () => {
  const project = gatedProject();
  const result = await readResource("markspec://entry/STK_0001", project);
  assertEquals(result.text, SOFT_GATE_MESSAGE);
});

Deno.test("listResourceDescriptors: returns empty list when gated", async () => {
  const project = gatedProject();
  const list = await listResourceDescriptors(project);
  assertEquals(list, []);
});

/**
 * @module mcp/tools/mod_test
 *
 * Soft-gate dispatch behaviour per ADR-023 §6.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dispatchTool } from "./mod.ts";
import type { Project } from "../project.ts";

function mockProject(detected: boolean): Project {
  return {
    projectRoot: detected ? "/proj" : undefined,
    markspecDetected: detected,
    softGateMessage: "No MarkSpec project found (mock)",
    config: undefined,
    profileChain: null,
    profile: undefined,
    delivers: [],
    getCompiled: () =>
      Promise.reject(new Error("getCompiled must not be called when gated")),
    forceRefresh: () =>
      Promise.reject(new Error("forceRefresh must not be called when gated")),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: () =>
      Promise.reject(
        new Error("readDeliveredDocument must not be called when gated"),
      ),
  };
}

/** A detected project with an empty compiled graph — for routing smoke tests. */
function emptyDetectedProject(): Project {
  return {
    projectRoot: "/proj",
    markspecDetected: true,
    softGateMessage: "",
    config: undefined,
    profileChain: null,
    profile: undefined,
    delivers: [],
    getCompiled: () =>
      Promise.resolve({
        entries: new Map(),
        links: [],
        forward: new Map(),
        reverse: new Map(),
        diagnostics: [],
        // deno-lint-ignore no-explicit-any
      } as any),
    forceRefresh: () =>
      Promise.reject(new Error("forceRefresh must not be called")),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: () => Promise.resolve(undefined),
  };
}

Deno.test("dispatchTool: returns soft-gate message when markspecDetected=false", async () => {
  const project = mockProject(false);
  const result = await dispatchTool("entry_search", { query: "x" }, project);
  assertEquals(result, "No MarkSpec project found (mock)");
});

Deno.test("dispatchTool: gates every tool name (entry_context)", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "entry_context",
    { id: "STK_0001" },
    project,
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates validate", async () => {
  const project = mockProject(false);
  const result = await dispatchTool("validate", {}, project);
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates markspec_refresh", async () => {
  const project = mockProject(false);
  const result = await dispatchTool("markspec_refresh", {}, project);
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates profile_describe", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "profile_describe",
    { name: "Stk" },
    project,
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates entry_show", async () => {
  const project = mockProject(false);
  const result = await dispatchTool("entry_show", { id: "X_0001" }, project);
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates entry_list", async () => {
  const project = mockProject(false);
  const result = await dispatchTool("entry_list", {}, project);
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates entry_neighborhood", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "entry_neighborhood",
    { id: "X_0001" },
    project,
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: unknown tool returns error message regardless of gate", async () => {
  const project = mockProject(false);
  let caught: Error | null = null;
  try {
    await dispatchTool("nonexistent", {}, project);
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("unknown tool"), true);
});

Deno.test("dispatchTool: entry_show routes", async () => {
  const project = emptyDetectedProject();
  const result = await dispatchTool("entry_show", { id: "X_0001" }, project);
  assertStringIncludes(result, "No entry with display ID X_0001");
});

Deno.test("dispatchTool: entry_list routes (summary default)", async () => {
  const result = await dispatchTool("entry_list", {}, emptyDetectedProject());
  assertStringIncludes(result, "Specification overview");
});

Deno.test("dispatchTool: entry_neighborhood routes", async () => {
  const result = await dispatchTool(
    "entry_neighborhood",
    { id: "X_0001" },
    emptyDetectedProject(),
  );
  assertStringIncludes(result, "No entry with display ID X_0001");
});

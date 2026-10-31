/**
 * @module mcp/server_test
 *
 * Structural assertions on SERVER_INSTRUCTIONS per ADR-023 §4. The text
 * itself is not testable for LLM-behavioural effect — these tests catch
 * accidental regressions to the trigger grammar (TRIGGER / PREFER / SKIP)
 * and the locked vocabulary anchors.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DeliveredDocument, ProfileChain } from "../core/mod.ts";
import type { Project } from "./project.ts";
import { listResourceDescriptors, readResource } from "./resources/mod.ts";
import { SERVER_INSTRUCTIONS } from "./server.ts";
import { entryDoc, memoryEnv, twoProjectFiles } from "./tools/testing.ts";
import { deliveredUri, entryUri } from "./uri.ts";
import { createWorkspace, type McpWorkspace } from "./workspace.ts";

Deno.test("SERVER_INSTRUCTIONS: contains TRIGGER block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "TRIGGER when");
});

Deno.test("SERVER_INSTRUCTIONS: contains PREFER over block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "PREFER over");
});

Deno.test("SERVER_INSTRUCTIONS: contains SKIP when block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "SKIP when");
});

Deno.test("SERVER_INSTRUCTIONS: lists the display-ID regex anchor", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "[A-Z]{2,}_[A-Z0-9_]+");
});

Deno.test("SERVER_INSTRUCTIONS: names grep/Read/Glob in PREFER over", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "grep");
  assertStringIncludes(SERVER_INSTRUCTIONS, "Read");
  assertStringIncludes(SERVER_INSTRUCTIONS, "Glob");
});

Deno.test("SERVER_INSTRUCTIONS: references the soft-gate phrase verbatim", () => {
  // SKIP rule keys on this exact phrase — see ADR-023 §6.3.
  assertStringIncludes(SERVER_INSTRUCTIONS, "No MarkSpec project found");
});

Deno.test("SERVER_INSTRUCTIONS: lists locked vocabulary nouns", () => {
  // Spot-check that the noun list survives — the full vocabulary is
  // documented in ADR-023 §3.
  for (
    const noun of [
      "requirements",
      "specifications",
      "ICD",
      "architecture",
      "verification",
      "validation",
      "ASIL",
      "EARS",
      "traceability",
    ]
  ) {
    assertStringIncludes(SERVER_INSTRUCTIONS, noun);
  }
});

// ---------------------------------------------------------------------------
// Resources across several projects
// ---------------------------------------------------------------------------

Deno.test("resources: entry URI listed once and read from both projects", async () => {
  const workspace = await createWorkspace(memoryEnv(twoProjectFiles(
    entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
    entryDoc("STK_0001", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
  )));
  const list = await listResourceDescriptors(workspace);
  const entryUris = list.filter((d) => d.uri === entryUri("STK_0001"));
  assertEquals(entryUris.length, 1);

  const read = await readResource(entryUri("STK_0001"), workspace);
  assertStringIncludes(read.text, "## Project: a");
  assertStringIncludes(read.text, "## Project: b");
  assertStringIncludes(read.text, "Alpha");
  assertStringIncludes(read.text, "Beta");
});

/** A stub project that delivers `path` from `profileId` with `text`. */
function deliveringProject(
  root: string,
  chainIds: readonly string[],
  doc: DeliveredDocument,
  text: string,
): Project {
  const chain = {
    tiers: chainIds.map((id) => ({ id })),
    effective: { delivers: [doc] },
  } as unknown as ProfileChain;
  return {
    projectRoot: root,
    markspecDetected: true,
    softGateMessage: "",
    config: undefined,
    profileChain: chain,
    profile: undefined,
    delivers: chainIds.includes(doc.profileId) ? [doc] : [],
    getCompiled: () => Promise.reject(new Error("not used")),
    forceRefresh: () => Promise.reject(new Error("not used")),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: (profileId, relPath) =>
      Promise.resolve(
        chainIds.includes(profileId) && relPath === doc.path ? text : undefined,
      ),
  };
}

/** A workspace over stub projects, listed in the given (label) order. */
function stubWorkspace(
  entries: readonly { label: string; project: Project }[],
): McpWorkspace {
  return {
    startRoot: "/work",
    projects: () => entries,
    softGateMessage: undefined,
    select: (label?: string) =>
      label === undefined ? entries : entries.filter((e) => e.label === label),
    ownerOf: () => undefined,
    canonicalPath: (path) => Promise.resolve(path),
    rediscover: () => Promise.resolve(),
    subscribeInvalidation: () => () => {},
  };
}

Deno.test("resources: delivered doc read from first project in label order", async () => {
  const doc: DeliveredDocument = {
    profileId: "platform-arch",
    profileVersion: "1.0.0",
    path: "reference/platform.md",
    absPath: "/cache/platform-arch/reference/platform.md",
    corpus: false,
  };
  const uri = deliveredUri("platform-arch", "reference/platform.md");

  // Both projects include the profile: the first label wins.
  const both = stubWorkspace([
    {
      label: "a",
      project: deliveringProject("/work/a", ["platform-arch"], doc, "from a"),
    },
    {
      label: "b",
      project: deliveringProject("/work/b", ["platform-arch"], doc, "from b"),
    },
  ]);
  assertEquals((await readResource(uri, both)).text, "from a");

  // Only the second project includes the profile: it is read from there.
  const second = stubWorkspace([
    { label: "a", project: deliveringProject("/work/a", ["other"], doc, "x") },
    {
      label: "b",
      project: deliveringProject("/work/b", ["platform-arch"], doc, "from b"),
    },
  ]);
  assertEquals((await readResource(uri, second)).text, "from b");
});

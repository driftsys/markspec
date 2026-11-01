/**
 * @module mcp/tools/testing_test
 *
 * Pins the ownership and selection rules of the shared stub workspace.
 */

import { assertEquals } from "@std/assert";
import type { Project } from "../project.ts";
import { stubWorkspace, workspaceOf } from "./testing.ts";

function projectAt(projectRoot: string): Project {
  return {
    projectRoot,
    markspecDetected: true,
    softGateMessage: "",
    config: undefined,
    profileChain: null,
    profile: undefined,
    delivers: [],
    getCompiled: () => Promise.reject(new Error("not used")),
    forceRefresh: () => Promise.reject(new Error("not used")),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: () => Promise.resolve(undefined),
  };
}

Deno.test("workspaceOf: ownerOf returns the project for a path inside its root", () => {
  const project = projectAt("/work/app");
  const owner = workspaceOf(project).ownerOf("/work/app/docs/req.md");
  assertEquals(owner?.project, project);
});

Deno.test("workspaceOf: ownerOf returns undefined for an unrelated path", () => {
  const owner = workspaceOf(projectAt("/work/app")).ownerOf("/other/req.md");
  assertEquals(owner, undefined);
});

Deno.test("workspaceOf: ownerOf ignores a sibling whose name starts with the root", () => {
  const owner = workspaceOf(projectAt("/work/app")).ownerOf("/work/app2/x.md");
  assertEquals(owner, undefined);
});

Deno.test("stubWorkspace: ownerOf prefers the nested project over its parent", () => {
  const parent = { label: ".", project: projectAt("/work") };
  const nested = { label: "app", project: projectAt("/work/app") };
  // Both entry orders: the nearest root decides, not the list position.
  for (const entries of [[parent, nested], [nested, parent]]) {
    const workspace = stubWorkspace(entries);
    assertEquals(workspace.ownerOf("/work/app/req.md"), nested);
    assertEquals(workspace.ownerOf("/work/other/req.md"), parent);
  }
});

Deno.test("stubWorkspace: select resolves labels", () => {
  const a = { label: "a", project: projectAt("/work/a") };
  const b = { label: "b", project: projectAt("/work/b") };
  const both = stubWorkspace([a, b]);
  assertEquals(both.select(undefined), [a, b]);
  assertEquals(both.select("b"), [b]);
  assertEquals(typeof both.select("zzz"), "string");
  // "." names a project only when there is exactly one.
  assertEquals(typeof both.select("."), "string");

  const only = stubWorkspace([a]);
  assertEquals(only.select("."), [a]);
});

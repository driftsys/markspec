/**
 * @module mcp/tools/project_list_test
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createWorkspace } from "../workspace.ts";
import { PROJECT_LIST_DESCRIPTOR, renderProjectList } from "./project_list.ts";
import {
  entryDoc,
  MEMORY_PARENT,
  memoryEnv,
  twoProjectFiles,
} from "./testing.ts";

Deno.test("renders one line per project", async () => {
  const ws = await createWorkspace(memoryEnv(twoProjectFiles(
    entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
    entryDoc("STK_0002", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
  )));
  // Compile only project a; project b stays lazy.
  await ws.projects()[0].project.getCompiled();
  assertEquals(
    await renderProjectList(ws),
    `- a — ${
      join(MEMORY_PARENT, "a")
    } — profile: @markspec/profile-default — 1 entries\n` +
      `- b — ${
        join(MEMORY_PARENT, "b")
      } — profile: @markspec/profile-default — not compiled yet\n`,
  );
});

Deno.test("PROJECT_LIST_DESCRIPTOR: read-only tool named project_list", () => {
  assertEquals(PROJECT_LIST_DESCRIPTOR.name, "project_list");
  assertEquals(PROJECT_LIST_DESCRIPTOR.annotations.readOnlyHint, true);
});

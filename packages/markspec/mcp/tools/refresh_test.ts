/**
 * @module mcp/tools/refresh_test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderRefresh } from "./refresh.ts";

Deno.test("renderRefresh: returns count summary", () => {
  const md = renderRefresh(1234, 5678);
  assertStringIncludes(md, "Refreshed.");
  assertStringIncludes(md, "1234 entries");
  assertStringIncludes(md, "5678 links");
});

Deno.test("renderRefresh: zero counts", () => {
  const md = renderRefresh(0, 0);
  assertStringIncludes(md, "Refreshed.");
  assertEquals(md.includes("0 entries"), true);
});

import { REFRESH_DESCRIPTOR } from "./refresh.ts";

Deno.test("REFRESH_DESCRIPTOR.description: has TRIGGER and PREFER blocks", () => {
  const desc = REFRESH_DESCRIPTOR.description;
  assertStringIncludes(desc, "TRIGGER when:");
  assertStringIncludes(desc, "PREFER over:");
});

Deno.test("REFRESH_DESCRIPTOR.description: names external-edit causes", () => {
  const desc = REFRESH_DESCRIPTOR.description;
  assertStringIncludes(desc, "CLI commands");
  assertStringIncludes(desc, "git checkout");
});

Deno.test("REFRESH_DESCRIPTOR.description: warns against unnecessary calls", () => {
  assertStringIncludes(
    REFRESH_DESCRIPTOR.description,
    "Do NOT call between back-to-back reads",
  );
});

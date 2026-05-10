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

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { PAGE_SIZE, renderList } from "./list.ts";

function entry(
  displayId: string,
  title: string,
  type?: string,
  labels: string[] = [],
): Entry {
  const rawAttributes = labels.length > 0
    ? [{ key: "Labels", value: labels.join(", ") }]
    : [];
  return {
    displayId: makeDisplayId(displayId),
    title,
    type,
    rawAttributes,
  } as unknown as Entry;
}

Deno.test("renderList: summary mode reports counts per type", () => {
  const entries = [
    entry("SWE_0001", "a", "software-requirement"),
    entry("SWE_0002", "b", "software-requirement"),
    entry("SYS_0001", "c", "system-requirement"),
  ];
  const text = renderList(entries, { mode: "summary" });
  assertStringIncludes(text, "3 entries");
  assertStringIncludes(text, "software-requirement: 2");
  assertStringIncludes(text, "system-requirement: 1");
});

Deno.test("renderList: full mode lists entries with links", () => {
  const entries = [entry("SWE_0001", "Title A", "software-requirement")];
  const text = renderList(entries, { mode: "full", page: 1 });
  assertStringIncludes(text, "SWE_0001");
  assertStringIncludes(text, "Title A");
});

Deno.test("renderList: full mode filters by type", () => {
  const entries = [
    entry("SWE_0001", "a", "software-requirement"),
    entry("SYS_0001", "b", "system-requirement"),
  ];
  const text = renderList(entries, {
    mode: "full",
    page: 1,
    type: "system-requirement",
  });
  assertStringIncludes(text, "SYS_0001");
  assertEquals(text.includes("SWE_0001"), false);
});

Deno.test("renderList: full mode filters by label", () => {
  const entries = [
    entry("SWE_0001", "a", "software-requirement", ["ASIL-B"]),
    entry("SWE_0002", "b", "software-requirement", ["QM"]),
  ];
  const text = renderList(entries, { mode: "full", page: 1, label: "ASIL-B" });
  assertStringIncludes(text, "SWE_0001");
  assertEquals(text.includes("SWE_0002"), false);
});

Deno.test("renderList: paginates and shows a next-page footer", () => {
  const entries = Array.from(
    { length: PAGE_SIZE + 5 },
    (_, i) =>
      entry(
        `SWE_${String(i).padStart(4, "0")}`,
        `t${i}`,
        "software-requirement",
      ),
  );
  const page1 = renderList(entries, { mode: "full", page: 1 });
  assertStringIncludes(page1, `Showing 1–50 of ${PAGE_SIZE + 5}`);
  assertStringIncludes(page1, "page=2");
  const page2 = renderList(entries, { mode: "full", page: 2 });
  assertStringIncludes(
    page2,
    `Showing ${PAGE_SIZE + 1}–${PAGE_SIZE + 5} of ${PAGE_SIZE + 5}`,
  );
  assertEquals(page2.includes("page=3"), false);
});

Deno.test("renderList: page past the end reports no entries on this page", () => {
  const entries = [entry("SWE_0001", "a", "software-requirement")];
  const text = renderList(entries, { mode: "full", page: 99 });
  assertStringIncludes(text, "No entries on page 99");
});

import { assertEquals } from "@std/assert";
import { formatProseSegments } from "./prose.ts";

/** Fake formatter: joins each paragraph onto one line (semantically
 * equivalent — a wrap-only change). */
const unwrap = (md: string): string =>
  md
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n(?!$)/g, " "))
    .join("\n\n") + "\n";

/** Fake destructive formatter: drops the last word of the segment. */
const truncate = (md: string): string =>
  md.trimEnd().split(" ").slice(0, -1).join(" ") + "\n";

const DOC = [
  "# Overview", // 0
  "", // 1
  "Some ragged", // 2
  "prose here.", // 3
  "", // 4
  "- [STK_0001] Title", // 5  ← entry extent [5, 10)
  "", // 6
  "  Body prose.", // 7
  "", // 8
  "      Id: 01JADYKACKQKGVGHT9K7Y6PBPA", // 9
  "", // 10
  "Trailing chapter", // 11
  "prose.", // 12
];

Deno.test("prose: formats segments outside entry extents only", () => {
  const res = formatProseSegments(DOC, [{ start: 5, end: 10 }], unwrap);
  assertEquals(res.changed, true);
  const text = res.lines.join("\n");
  // prose got unwrapped
  assertEquals(text.includes("Some ragged prose here."), true);
  assertEquals(text.includes("Trailing chapter prose."), true);
  // entry block untouched, byte for byte
  assertEquals(
    res.lines[res.lines.indexOf("- [STK_0001] Title") + 2],
    "  Body prose.",
  );
  assertEquals(text.includes("      Id: 01JADYKACKQKGVGHT9K7Y6PBPA"), true);
});

Deno.test("prose: boundary blank lines around entries are preserved", () => {
  const res = formatProseSegments(DOC, [{ start: 5, end: 10 }], unwrap);
  const idx = res.lines.indexOf("- [STK_0001] Title");
  assertEquals(res.lines[idx - 1], "");
  assertEquals(res.lines[idx + 5], "");
});

Deno.test("prose: gate rejects non-equivalent output, reports fallback", () => {
  const res = formatProseSegments(DOC, [{ start: 5, end: 10 }], truncate);
  assertEquals(res.changed, false);
  assertEquals(res.lines, DOC);
  assertEquals(res.fallbackStarts.length, 2); // both prose segments rejected
});

Deno.test("prose: no entries — whole document is one segment", () => {
  const res = formatProseSegments(
    ["Ragged", "line."],
    [],
    unwrap,
  );
  assertEquals(res.lines, ["Ragged line."]);
  assertEquals(res.changed, true);
});

Deno.test("prose: overlapping or malformed extents never duplicate lines or reach the formatter", () => {
  const calls: string[] = [];
  const identitySpy = (md: string): string => {
    calls.push(md);
    return md.endsWith("\n") ? md : md + "\n";
  };
  const res = formatProseSegments(
    DOC,
    [{ start: 5, end: 10 }, { start: 8, end: 12 }, { start: 5, end: 3 }],
    identitySpy,
  );
  // Output is byte-identical: every input line exactly once, no change.
  assertEquals(res.lines, DOC);
  assertEquals(res.changed, false);
  // No entry-block line was ever handed to the formatter.
  for (const chunk of calls) {
    assertEquals(chunk.includes("STK_0001"), false);
    assertEquals(chunk.includes("Id: 01JADYKACKQKGVGHT9K7Y6PBPA"), false);
  }
});

Deno.test("prose: already-canonical input is a no-op", () => {
  const res = formatProseSegments(
    [
      "One line.",
      "",
      "- [STK_0001] T",
      "",
      "      Id: 01JADYKACKQKGVGHT9K7Y6PBPA",
    ],
    [{ start: 2, end: 5 }],
    (md) => md.endsWith("\n") ? md : md + "\n",
  );
  assertEquals(res.changed, false);
});

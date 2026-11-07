/**
 * @module core/util/fence_test
 *
 * Unit tests for {@linkcode walkProseLines} — the prose-line walker
 * that skips lines inside fenced code blocks. These cover the
 * boundary conditions the prior copy-pasted code couldn't easily
 * exercise.
 */

import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { processor } from "../parser/remark.ts";
import { fencedCodeLines, isLineFenced, walkProseLines } from "./fence.ts";

Deno.test("walkProseLines: yields every line when there are no fences", () => {
  const body = "alpha\nbeta\ngamma";
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["alpha", "beta", "gamma"]);
});

Deno.test("walkProseLines: skips lines inside backtick fenced code", () => {
  const body = [
    "before",
    "```ts",
    "const x = 1;",
    "```",
    "after",
  ].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["before", "after"]);
});

Deno.test("walkProseLines: skips lines inside tilde fenced code", () => {
  const body = ["pre", "~~~", "verbatim", "~~~", "post"].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["pre", "post"]);
});

Deno.test("walkProseLines: index argument is the original 0-based line index", () => {
  const body = ["a", "```", "code", "```", "b"].join("\n");
  const indices: number[] = [];
  walkProseLines(body, (_line, i) => indices.push(i));
  assertEquals(indices, [0, 4]);
});

Deno.test("walkProseLines: a mismatched marker leaves the fence open", () => {
  const body = ["a", "~~~", "x", "```", "b"].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["a"]);
});

Deno.test("walkProseLines: fence markers accept leading spaces", () => {
  const body = ["a", "   ```", "   x", "   ```", "b"].join("\n");
  const yielded: string[] = [];
  walkProseLines(body, (line) => yielded.push(line));
  assertEquals(yielded, ["a", "b"]);
});

Deno.test("walkProseLines: empty body yields one empty line", () => {
  let calls = 0;
  walkProseLines("", () => calls++);
  // `"".split("\n")` is `[""]`, so one empty line still goes to cb.
  assertEquals(calls, 1);
});

// --- isLineFenced ---

Deno.test("isLineFenced: false for a plain line outside any fence", () => {
  const body = ["before", "```", "code", "```", "after"].join("\n");
  assertEquals(isLineFenced(body, 0), false);
  assertEquals(isLineFenced(body, 4), false);
});

Deno.test("isLineFenced: true for content inside a fenced block", () => {
  const body = ["before", "```", "code", "```", "after"].join("\n");
  assertEquals(isLineFenced(body, 2), true);
});

Deno.test("isLineFenced: true for the fence-marker lines themselves", () => {
  const body = ["before", "```", "code", "```", "after"].join("\n");
  assertEquals(isLineFenced(body, 1), true);
  assertEquals(isLineFenced(body, 3), true);
});

Deno.test("isLineFenced: true for a tilde-fenced line", () => {
  const body = ["pre", "~~~", "verbatim", "~~~", "post"].join("\n");
  assertEquals(isLineFenced(body, 2), true);
});

Deno.test("isLineFenced: agrees with walkProseLines across every line of a document", () => {
  const body = [
    "a",
    "```md",
    "- [REQ-001] example",
    "```",
    "b",
    "~~~",
    "c",
    "~~~",
    "d",
  ].join("\n");
  const skipped = new Set<number>();
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) skipped.add(i);
  walkProseLines(body, (_line, i) => skipped.delete(i));
  for (let i = 0; i < lines.length; i++) {
    assertEquals(isLineFenced(body, i), skipped.has(i), `line ${i}`);
  }
});

Deno.test("isLineFenced: out-of-range line index returns false", () => {
  const body = ["a", "b"].join("\n");
  assertEquals(isLineFenced(body, 99), false);
  assertEquals(isLineFenced(body, -1), false);
});

// Literal prose indices independently specify the CommonMark fence boundaries. Both public helpers must honor the same boundaries.
const fenceCases = [
  {
    name: "shorter backtick fence is literal content",
    lines: ["before", "````md", "```", "hidden", "````", "after"],
    prose: [0, 5],
  },
  {
    name: "shorter tilde fence is literal content",
    lines: ["before", "~~~~text", "~~~", "hidden", "~~~~", "after"],
    prose: [0, 5],
  },
  {
    name: "tilde marker cannot close a backtick fence",
    lines: ["before", "```md", "~~~", "hidden", "```", "after"],
    prose: [0, 5],
  },
  {
    name: "backtick marker cannot close a tilde fence",
    lines: ["before", "~~~text", "```", "hidden", "~~~", "after"],
    prose: [0, 5],
  },
  {
    name: "text after a marker prevents closure",
    lines: ["before", "```md", "```text", "hidden", "```", "after"],
    prose: [0, 5],
  },
  {
    name: "mixed marker suffix prevents closure",
    lines: ["before", "~~~text", "~~~`", "hidden", "~~~", "after"],
    prose: [0, 5],
  },
  {
    name: "four-space indent cannot close",
    lines: ["before", "```md", "    ```", "visible", "after"],
    prose: [0],
  },
  {
    name: "tab indent cannot close",
    lines: ["before", "```md", "\t```", "visible", "after"],
    prose: [0],
  },
  {
    name: "longer backtick closer allows spaces and tabs after it",
    lines: ["before", "   ```md", "   hidden", "   ````` \t", "after"],
    prose: [0, 4],
  },
  {
    name: "longer tilde closer allows spaces and tabs after it",
    lines: ["before", " ~~~text", " hidden", "   ~~~~~\t ", "after"],
    prose: [0, 4],
  },
  {
    name: "four-space indent is not a fence",
    lines: ["before", "    ```md", "    hidden", "after"],
    prose: [0, 1, 2, 3],
  },
  {
    name: "tab indent is not a fence",
    lines: ["before", "\t~~~text", "    hidden", "after"],
    prose: [0, 1, 2, 3],
  },
  {
    name: "nonbreaking space is not fence indentation",
    lines: ["before", "\u00a0```md", " hidden", "after"],
    prose: [0, 1, 2, 3],
  },
  {
    name: "backtick in info string prevents opening",
    lines: ["before", "```md `example`", "visible", "after"],
    prose: [0, 1, 2, 3],
  },
  {
    name: "backticks are allowed in tilde info strings",
    lines: ["before", "~~~md `example`", "hidden", "~~~", "after"],
    prose: [0, 4],
  },
  {
    name: "unclosed fence extends to end of input",
    lines: ["before", "````md", "```", "hidden"],
    prose: [0],
  },
];

for (const { name, lines, prose } of fenceCases) {
  for (const newline of ["\n", "\r\n"]) {
    const ending = newline === "\n" ? "LF" : "CRLF";
    Deno.test(`fence helpers: ${name} (${ending})`, () => {
      const body = lines.join(newline);
      const yielded: Array<[string, number]> = [];
      walkProseLines(body, (line, i) => yielded.push([line, i]));
      // Callback text preserves the original CR for lossless write-back.
      assertEquals(
        yielded,
        prose.map((i) => [
          lines[i] + (newline === "\r\n" && i < lines.length - 1 ? "\r" : ""),
          i,
        ]),
      );
      for (let i = 0; i < lines.length; i++) {
        assertEquals(isLineFenced(body, i), !prose.includes(i), `line ${i}`);
      }
    });
  }
}

for (const newline of ["\n", "\r\n"]) {
  Deno.test(`fence helpers: four-space list-item fence (${JSON.stringify(newline)})`, () => {
    const body = [
      "- Example",
      "    ```md",
      "      Satisfies: SYS_OLD",
      "    ```",
      "- Sibling",
    ].join(newline);
    const prose: number[] = [];
    walkProseLines(body, (_, i) => prose.push(i));
    assertEquals(prose, [0, 4]);
    assertEquals(isLineFenced(body, 2), true);
  });
  Deno.test(`fence helpers: sibling ends unclosed long list-item fence (${JSON.stringify(newline)})`, () => {
    const body = [
      "- Example",
      "  ````md",
      "  ```",
      "",
      "- [REQ-001] Sibling",
      "      Satisfies: SYS_OLD",
    ].join(newline);
    const prose: number[] = [];
    walkProseLines(body, (_, i) => prose.push(i));
    assertEquals(prose, [0, 4, 5]);
    assertEquals(isLineFenced(body, 3), true);
    assertEquals(isLineFenced(body, 4), false);
  });
}

for (const newline of ["\n", "\r\n"]) {
  for (
    const { name, lines, prose } of [
      {
        name: "dedented content stays fenced",
        lines: [
          "   ~~~opaque_dsl",
          "  alpha",
          "",
          "",
          "  beta",
          "   ~~~",
          "live",
        ],
        prose: [6],
      },
      {
        name: "dedented closer ends the fence",
        lines: ["   ~~~text", "   example", "~~~", "- [REQ-001] Live"],
        prose: [3],
      },
      {
        name: "block quote fence",
        lines: [" > ~~~text", " > REQ-001", " > ~~~", "live"],
        prose: [3],
      },
      {
        name: "list marker fence",
        lines: ["- ~~~text", "  REQ-001", "  ~~~", "- Live"],
        prose: [3],
      },
      {
        name: "indented trailer containing backticks",
        lines: [
          "- Entry",
          "",
          "      Satisfies: SYS_OLD",
          "      ```",
          "      Id: identifier",
        ],
        prose: [0, 1, 2, 3, 4],
      },
    ]
  ) {
    Deno.test(`fence helpers: ${name} (${JSON.stringify(newline)})`, () => {
      const text = lines.join(newline);
      const actual: number[] = [];
      walkProseLines(text, (_, i) => actual.push(i));
      assertEquals(actual, prose);
      for (let i = 0; i < lines.length; i++) {
        assertEquals(isLineFenced(text, i), !prose.includes(i));
      }
    });
  }
}

Deno.test("fence helpers: unchanged text is parsed once across queries", () => {
  const text = "- ~~~text\n  hidden\n  ~~~\n- live";
  const parse = processor.parse.bind(processor);
  using parseStub = stub(processor, "parse", (source) => {
    return parse(source);
  });
  const actual: number[] = [];
  walkProseLines(text, (_, i) => actual.push(i));
  assertEquals(actual, [3]);
  assertEquals(parseStub.calls.length, 1);
  const fencedLines = fencedCodeLines(text);
  assertEquals(parseStub.calls.length, 1);
  walkProseLines(text, () => {}, fencedLines);
  for (let i = 0; i < 4; i++) {
    assertEquals(isLineFenced(text, i, fencedLines), i < 3);
  }
  assertEquals(parseStub.calls.length, 1);
});

Deno.test("fence helpers: cache keys use exact text and retain recently queried documents", () => {
  const first = "~~~text\ncache first\n~~~";
  const second = "~~~text\ncache second\n~~~";
  const parse = processor.parse.bind(processor);
  using parseStub = stub(processor, "parse", (source) => parse(source));
  assertEquals([...fencedCodeLines(first)], [0, 1, 2]);
  assertEquals([...fencedCodeLines(second)], [0, 1, 2]);
  assertEquals(parseStub.calls.length, 2);
  // Repeated project scans must reuse sets for each unchanged file.
  for (const text of [first, second, first, second]) {
    walkProseLines(text, () => {});
  }
  assertEquals(parseStub.calls.length, 2);
  assertEquals([...fencedCodeLines(first + "\nlive")], [0, 1, 2]);
  assertEquals(parseStub.calls.length, 3);
});

Deno.test("fence helpers: bounded cache evicts the least recently queried text", () => {
  const first = "~~~\nLRU first\n~~~";
  const documents = Array.from({ length: 63 }, (_, i) => `~~~\nLRU ${i}\n~~~`);
  const parse = processor.parse.bind(processor);
  using parseStub = stub(processor, "parse", (source) => parse(source));
  fencedCodeLines(first);
  for (const text of documents) fencedCodeLines(text);
  assertEquals(parseStub.calls.length, 64);
  fencedCodeLines(first); // Refresh this document before exceeding capacity.
  assertEquals(parseStub.calls.length, 64);
  fencedCodeLines("~~~\nLRU overflow\n~~~");
  fencedCodeLines(first);
  assertEquals(parseStub.calls.length, 65);
  // The oldest untouched document must be parsed again after eviction.
  assertEquals([...fencedCodeLines(documents[0])], [0, 1, 2]);
  assertEquals(parseStub.calls.length, 66);
});

Deno.test("fencedCodeLines: changing a returned set does not alter the cache", () => {
  const text = "```\nREQ-001\n```\n";
  const first = fencedCodeLines(text) as Set<number>;
  first.clear();
  assertEquals([...fencedCodeLines(text)], [0, 1, 2]);
  assertEquals(isLineFenced(text, 1), true);
});

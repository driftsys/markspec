import { assertEquals, assertRejects } from "@std/assert";
import {
  compileGlob,
  parseEditorConfig,
  resolveEditorConfigStyle,
} from "./editorconfig.ts";

/** An in-memory file system for the injected `readFile`. */
function fakeFs(files: Record<string, string>) {
  return (path: string) => Promise.resolve(files[path]);
}

Deno.test("resolveEditorConfigStyle: no .editorconfig gives width 80 and LF", async () => {
  const style = await resolveEditorConfigStyle("/p/a.md", fakeFs({}));
  assertEquals(style, { lineWidth: 80, endOfLine: "lf", endOfLineSet: false });
});

Deno.test("resolveEditorConfigStyle: reads max_line_length and end_of_line", async () => {
  const style = await resolveEditorConfigStyle(
    "/p/docs/a.md",
    fakeFs({
      "/p/.editorconfig":
        "root = true\n[*]\nend_of_line = CRLF\n[*.md]\nmax_line_length = 100\n",
    }),
  );
  assertEquals(style, {
    lineWidth: 100,
    endOfLine: "crlf",
    endOfLineSet: true,
  });
});

Deno.test("resolveEditorConfigStyle: end_of_line = cr maps to lf (prim)", async () => {
  const style = await resolveEditorConfigStyle(
    "/p/a.md",
    fakeFs({ "/p/.editorconfig": "[*]\nend_of_line = cr\n" }),
  );
  assertEquals(style.endOfLine, "lf");
});

Deno.test("resolveEditorConfigStyle: off, unset and invalid widths give 80", async () => {
  for (const value of ["off", "unset", "wide", "-1", "1.5"]) {
    const style = await resolveEditorConfigStyle(
      "/p/a.md",
      fakeFs({ "/p/.editorconfig": `[*]\nmax_line_length = ${value}\n` }),
    );
    assertEquals(style.lineWidth, 80, value);
  }
});

Deno.test("resolveEditorConfigStyle: nearer file overrides, root stops the walk", async () => {
  const files = {
    "/.editorconfig": "[*]\nend_of_line = crlf\n",
    "/p/.editorconfig": "root = true\n[*]\nmax_line_length = 100\n",
    "/p/sub/.editorconfig": "[*.md]\nmax_line_length = 90\n",
  };
  assertEquals(
    await resolveEditorConfigStyle("/p/sub/a.md", fakeFs(files)),
    { lineWidth: 90, endOfLine: "lf", endOfLineSet: false },
  );
  assertEquals(
    await resolveEditorConfigStyle("/p/a.md", fakeFs(files)),
    { lineWidth: 100, endOfLine: "lf", endOfLineSet: false },
  );
});

Deno.test("resolveEditorConfigStyle: an invalid line drops the whole chain", async () => {
  const style = await resolveEditorConfigStyle(
    "/p/sub/a.md",
    fakeFs({
      "/p/.editorconfig": "root = true\n[*]\nmax_line_length = 100\n",
      "/p/sub/.editorconfig": "[*]\ngarbage\n",
    }),
  );
  assertEquals(style, { lineWidth: 80, endOfLine: "lf", endOfLineSet: false });
});

Deno.test("resolveEditorConfigStyle: a glob with / is relative to the config", async () => {
  const files = {
    "/p/.editorconfig": "root = true\n[docs/*.md]\nmax_line_length = 100\n",
  };
  assertEquals(
    (await resolveEditorConfigStyle("/p/docs/a.md", fakeFs(files))).lineWidth,
    100,
  );
  assertEquals(
    (await resolveEditorConfigStyle("/p/x/docs/a.md", fakeFs(files)))
      .lineWidth,
    80,
  );
});

Deno.test("parseEditorConfig: comments, trailing comments after ] and root", () => {
  const parsed = parseEditorConfig(
    "﻿; comment\nroot = TRUE\n# c\n[*.md] ; trailing\nkey = a # kept\n",
  );
  if (parsed === "invalid") throw new Error("unexpected invalid");
  assertEquals(parsed.root, true);
  assertEquals(parsed.sections.length, 1);
  assertEquals(parsed.sections[0].pairs, [["key", "a # kept"]]);
  assertEquals(parsed.sections[0].matcher("x/y.md"), true);
});

Deno.test("parseEditorConfig: `key =` with no value is invalid", () => {
  assertEquals(parseEditorConfig("[*]\nkey =\n"), "invalid");
  assertEquals(parseEditorConfig("[]\n"), "invalid");
});

Deno.test("compileGlob: EditorConfig glob forms", () => {
  const cases: Array<[string, string, boolean]> = [
    ["*", "a.md", true],
    ["*", "dir/a.md", true],
    ["*.md", "dir/a.md", true],
    ["*.md", "a.mdx", false],
    ["*.{md,txt}", "a.txt", true],
    ["*.{md,txt}", "a.ts", false],
    ["?.md", "a.md", true],
    ["?.md", "ab.md", false],
    ["[ab].md", "b.md", true],
    ["[!ab].md", "b.md", false],
    ["file{1..3}.md", "file2.md", true],
    ["file{1..3}.md", "file4.md", false],
    ["/a.md", "a.md", true],
    ["/a.md", "x/a.md", false],
    ["docs/**.md", "docs/x/y.md", true],
    ["{single}.md", "{single}.md", true],
    ["Makefile", "sub/Makefile", true],
  ];
  for (const [glob, path, expected] of cases) {
    assertEquals(compileGlob(glob)(path), expected, `${glob} vs ${path}`);
  }
});

Deno.test("resolveEditorConfigStyle: max_line_length parses as Rust usize (prim)", async () => {
  for (
    const [value, width] of [["0", 0], ["+100", 100], ["0120", 120]] as const
  ) {
    const style = await resolveEditorConfigStyle(
      "/p/a.md",
      fakeFs({ "/p/.editorconfig": `[*]\nmax_line_length = ${value}\n` }),
    );
    assertEquals(style.lineWidth, width, value);
  }
});

Deno.test("resolveEditorConfigStyle: endOfLineSet tells a set key from the default", async () => {
  const set = await resolveEditorConfigStyle(
    "/p/a.md",
    fakeFs({ "/p/.editorconfig": "[*]\nend_of_line = lf\n" }),
  );
  assertEquals(set.endOfLineSet, true);
  const invalid = await resolveEditorConfigStyle(
    "/p/a.md",
    fakeFs({ "/p/.editorconfig": "[*]\nend_of_line = native\n" }),
  );
  assertEquals(invalid, {
    lineWidth: 80,
    endOfLine: "lf",
    endOfLineSet: false,
  });
});

Deno.test("resolveEditorConfigStyle: a relative path is rejected, the cwd is never read", async () => {
  await assertRejects(
    () => resolveEditorConfigStyle("docs/a.md", fakeFs({})),
    TypeError,
    "absolute path",
  );
});

Deno.test("compileGlob: a glob ending in / matches the files of that directory (ec4rs)", () => {
  assertEquals(compileGlob("docs/")("docs/a.md"), true);
  assertEquals(compileGlob("docs/")("docs/x/a.md"), false);
  assertEquals(compileGlob("docs/")("other/a.md"), false);
});

Deno.test("compileGlob: a set never spans / (ec4rs splits on / first)", () => {
  // `[a/b]` is the literal text `[a` then `/` then `b]`.
  assertEquals(compileGlob("[a/b].md")("[a/b].md"), true);
  assertEquals(compileGlob("[a/b].md")("a.md"), false);
  // A negated set never matches `/`.
  assertEquals(compileGlob("x[!a]y")("x/y"), false);
  assertEquals(compileGlob("x[!a]y")("xby"), true);
});

Deno.test("resolveEditorConfigStyle: Windows paths walk up to the drive root on any host", async () => {
  // Config paths are read with `/` separators, which Windows accepts.
  const files = {
    "C:/.editorconfig": "[*]\nend_of_line = crlf\n",
    "C:/p/.editorconfig": "[docs/*.md]\nmax_line_length = 100\n",
  };
  for (const path of ["C:\\p\\docs\\a.md", "C:/p/docs/a.md"]) {
    assertEquals(
      await resolveEditorConfigStyle(path, fakeFs(files)),
      { lineWidth: 100, endOfLine: "crlf", endOfLineSet: true },
      path,
    );
  }
  assertEquals(
    (await resolveEditorConfigStyle("C:\\p\\x\\docs\\a.md", fakeFs(files)))
      .lineWidth,
    80,
  );
});

Deno.test("resolveEditorConfigStyle: a UNC path stops at the share root", async () => {
  const seen: string[] = [];
  const style = await resolveEditorConfigStyle(
    "\\\\server\\share\\p\\a.md",
    (path) => {
      seen.push(path);
      return Promise.resolve(
        path === "//server/share/.editorconfig"
          ? "[*.md]\nmax_line_length = 90\n"
          : undefined,
      );
    },
  );
  assertEquals(style.lineWidth, 90);
  assertEquals(seen, [
    "//server/share/p/.editorconfig",
    "//server/share/.editorconfig",
  ]);
});

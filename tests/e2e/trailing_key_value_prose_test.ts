/**
 * @module tests/e2e/trailing_key_value_prose_test
 *
 * E2E (#916): a trailing `Key: value` line directly under prose, or a final
 * paragraph that uses a key outside the core set (`Note:`), is body text,
 * not an attribute. `markspec fmt` keeps such prose in the body paragraph
 * (it may reflow the paragraph text) and never moves it into the trailer,
 * and `check` reports no MSL-P020 for it. An `Id:` run under prose stays the
 * trailer with an MSL-P020 warning.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspecPersist } from "./helpers.ts";

const DOC = `# Doc

- [REQ_0001] Debounce

  The driver shall debounce the input within 5 ms.
  Status: draft

- [REQ_0002] Retry

  The client shall retry a failed request 3 times.

  Rationale: the link drops for up to 1 s.
  Note: see the field report.
`;

Deno.test("check: trailing Key: value prose raises no MSL-P020 (#916)", async () => {
  const run = await markspecPersist(["check", "doc.md"], {
    files: { "project.yaml": "name: p916\nversion: 0.1.0\n", "doc.md": DOC },
  });
  try {
    assertEquals((run.stderr + run.stdout).includes("MSL-P020"), false);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: trailing Key: value prose stays in the body (#916)", async () => {
  const run = await markspecPersist(["fmt", "doc.md"], {
    files: { "project.yaml": "name: p916\nversion: 0.1.0\n", "doc.md": DOC },
  });
  try {
    assertEquals(run.code, 0, `stderr: ${run.stderr}`);
    const out = await Deno.readTextFile(`${run.dir}/doc.md`);
    // The prose stays in its paragraph (the formatter reflows the paragraph
    // text); none of it moved into the indented trailer.
    assertStringIncludes(
      out,
      "  The driver shall debounce the input within 5 ms. Status: draft\n",
    );
    assertStringIncludes(
      out,
      "  Rationale: the link drops for up to 1 s. Note: see the field report.\n",
    );
    assertEquals(out.includes("      Status:"), false);
    assertEquals(out.includes("      Rationale:"), false);
    assertEquals(out.includes("      Note:"), false);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

const ID_RUN_DOC = `# Doc

- [REQ_0001] Debounce

  The driver shall debounce the input within 5 ms.
  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
  Satisfies: SYS_0001
`;

Deno.test("check warns and fmt keeps the Id of an Id run under prose (#916)", async () => {
  const files = {
    "project.yaml": "name: p916\nversion: 0.1.0\n",
    "doc.md": ID_RUN_DOC,
  };
  const checked = await markspecPersist(["check", "doc.md"], { files });
  try {
    const out = checked.stderr + checked.stdout;
    assertStringIncludes(out, "warning[MSL-P020]");
    assertEquals(out.includes("error[MSL-P020]"), false);
  } finally {
    await Deno.remove(checked.dir, { recursive: true });
  }

  const run = await markspecPersist(["fmt", "doc.md"], { files });
  try {
    assertEquals(run.code, 0, `stderr: ${run.stderr}`);
    const out = await Deno.readTextFile(`${run.dir}/doc.md`);
    assertStringIncludes(
      out,
      "  The driver shall debounce the input within 5 ms.\n\n" +
        "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n" +
        "      Satisfies: SYS_0001\n",
    );
    assertEquals(out.match(/Id: /g)?.length, 1);
    const again = await markspecPersist(["fmt", "doc.md"], {
      files: { "project.yaml": files["project.yaml"], "doc.md": out },
    });
    try {
      assertEquals(await Deno.readTextFile(`${again.dir}/doc.md`), out);
    } finally {
      await Deno.remove(again.dir, { recursive: true });
    }
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

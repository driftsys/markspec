/** CLI acceptance coverage for `.markspec.yaml` discovery precedence. */

import { assertEquals } from "@std/assert";
import { markspecInDir, markspecPersist } from "./helpers.ts";

Deno.test("check: exclude wins over root and nested gitignores for bare and directory scopes", async () => {
  const run = await markspecPersist(["check", "--format", "json"], {
    files: {
      ".markspec.yaml": `exclude:
  - secrets/
  - "!dist/"
  - "!dist/keep.md"
  - "!docs/build/"
  - "!docs/build/keep.md"
`,
      ".gitignore": "!secrets/\ndist/\n",
      "secrets/broken.md": "- [REQ-0001] Excluded entry\n",
      "docs/.gitignore": "!secrets/\nbuild/\n",
      "docs/secrets/broken.md": "- [REQ-0002] Excluded nested entry\n",
      "dist/.gitignore": "*.md\n",
      "dist/keep.md": "- [REQ-0003] Re-included root entry\n",
      "docs/build/.gitignore": "*.md\n",
      "docs/build/keep.md": "- [REQ-0004] Re-included nested entry\n",
    },
  });
  try {
    for (
      const result of [
        run,
        await markspecInDir(run.dir, ["check", ".", "--format", "json"]),
      ]
    ) {
      assertEquals(result.code, 1, result.stderr);
      const diagnostics = JSON.parse(result.stdout) as {
        location?: { file: string };
      }[];
      const files = diagnostics.map((d) =>
        d.location?.file.replaceAll("\\", "/") ?? ""
      );
      assertEquals(
        files.some((f) => f.includes("secrets/")),
        false,
        result.stdout,
      );
      for (const expected of ["dist/keep.md", "docs/build/keep.md"]) {
        assertEquals(
          files.some((f) => f.endsWith(expected)),
          true,
          result.stdout,
        );
      }
    }
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: negations keep hidden directories outside bare and directory scopes", async () => {
  const run = await markspecPersist(["check", "--format", "json"], {
    files: {
      ".markspec.yaml": 'exclude: ["!*/", "!.worktrees/", "!.hidden/"]\n',
      ".gitignore": "*\n!*/\n!*.md\n",
      ".worktrees/copy/requirements.md": "- [REQ-0001] Hidden entry\n",
      "docs/.hidden/requirements.md": "- [REQ-0002] Nested hidden entry\n",
      "docs/requirements.md": "- [REQ-0003] Visible entry\n",
    },
  });
  try {
    for (
      const result of [
        run,
        await markspecInDir(run.dir, ["check", ".", "--format", "json"]),
      ]
    ) {
      assertEquals(result.code, 1, result.stderr);
      const diagnostics = JSON.parse(result.stdout) as {
        location?: { file: string };
      }[];
      const files = [
        ...new Set(
          diagnostics.flatMap((d) =>
            d.location ? [d.location.file.replaceAll("\\", "/")] : []
          ),
        ),
      ];
      assertEquals(files.length, 1, result.stdout);
      assertEquals(
        /(^|\/)docs\/requirements\.md$/.test(files[0]),
        true,
        result.stdout,
      );
    }
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

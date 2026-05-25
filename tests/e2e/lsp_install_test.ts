/**
 * @module tests/e2e/lsp_install_test
 *
 * End-to-end tests for `markspec lsp install --editor=neovim`. Exercises
 * the orchestrator wiring Tasks 1-5 — workspace marker discovery,
 * managed Lua block, timestamped sidecar backup, diff preview, atomic
 * write, --print, --remove, idempotence, and non-TTY safety.
 *
 * The `markspec()` helper spawns the CLI as a subprocess with piped
 * stdin, so `Deno.stdin.isTerminal()` returns false inside the test —
 * which is exactly what we want to exercise the non-TTY branch.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { markspec } from "./helpers.ts";

Deno.test(
  "lsp install neovim: workspace + --force writes block to workspace path",
  async () => {
    const { code, stdout, stderr } = await markspec(
      [
        "lsp",
        "install",
        "--editor=neovim",
        "--scope=workspace",
        "--binary-path=/usr/local/bin/markspec",
        "--force",
      ],
      {
        files: { "markspec.yaml": "" },
        permissions: ["--allow-env"],
      },
    );
    assertEquals(code, 0);
    assertEquals(stdout, "");
    assertStringIncludes(stderr, "wrote ");
    // Normalize path separators so the assertion is portable across
    // POSIX and Windows runners (CI runs on both).
    assertStringIncludes(stderr.replaceAll("\\", "/"), ".nvim/markspec.lua");
    // Backup is NOT written when the original file didn't exist.
    assert(!stderr.includes("backup:"));
  },
);

Deno.test(
  "lsp install neovim: --print emits file content to stdout, would-write to stderr",
  async () => {
    const { code, stdout, stderr } = await markspec(
      [
        "lsp",
        "install",
        "--editor=neovim",
        "--scope=user",
        "--print",
        "--binary-path=markspec",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "-- >>> markspec (managed) >>>");
    assertStringIncludes(stdout, "cmd = { 'markspec', 'lsp', '--stdio' }");
    assertStringIncludes(stderr, "would write to ");
  },
);

Deno.test(
  "lsp install neovim: workspace requested but no marker → fallback (snapshot stderr)",
  async (t) => {
    const { code, stderr } = await markspec(
      [
        "lsp",
        "install",
        "--editor=neovim",
        "--scope=workspace",
        "--print",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    // Snapshot only the workspace-fallback preamble line — the
    // "would write to <user-config>" line varies by host HOME.
    const preamble = stderr.split("\n")[0];
    assertNotEquals(preamble, "");
    await assertSnapshot(t, preamble);
  },
);

Deno.test(
  "lsp install: unknown editor suggests correction",
  async () => {
    const { code, stderr } = await markspec(
      ["lsp", "install", "--editor=neoviim", "--print"],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "unknown editor 'neoviim'");
    assertStringIncludes(stderr, "did you mean: neovim");
  },
);

Deno.test(
  "lsp install neovim: non-TTY without --force → exit 1 with remediation",
  async () => {
    const { code, stderr } = await markspec(
      ["lsp", "install", "--editor=neovim", "--scope=workspace"],
      {
        files: { "markspec.yaml": "" },
        permissions: ["--allow-env"],
      },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "non-interactive");
    assertStringIncludes(stderr, "--force");
    // Verify diff and remediation message are separated by exactly one newline
    // (renderDiff returns content with a trailing \n; there must be no blank
    // line between the diff and the error message).
    assert(!stderr.includes("\n\nerror: non-interactive"));
    assertStringIncludes(stderr, "\nerror: non-interactive");
  },
);

Deno.test(
  "lsp install neovim: existing empty config file → backup is still created",
  async () => {
    // Pre-populate .nvim/markspec.lua as an empty file. Per §6.3, the
    // orchestrator must back up any extant file, even an empty placeholder.
    const { code, stderr } = await markspec(
      [
        "lsp",
        "install",
        "--editor=neovim",
        "--scope=workspace",
        "--binary-path=markspec",
        "--force",
      ],
      {
        files: {
          "markspec.yaml": "",
          ".nvim/markspec.lua": "",
        },
        permissions: ["--allow-env"],
      },
    );
    assertEquals(code, 0);
    assertStringIncludes(stderr, "backup:");
  },
);

Deno.test(
  "lsp install neovim: --remove with no existing block → exit 0 already-removed",
  async () => {
    const { code, stderr } = await markspec(
      [
        "lsp",
        "install",
        "--editor=neovim",
        "--scope=workspace",
        "--remove",
        "--force",
      ],
      {
        files: { "markspec.yaml": "" },
        permissions: ["--allow-env"],
      },
    );
    assertEquals(code, 0);
    assertStringIncludes(stderr, "already removed");
  },
);

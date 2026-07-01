/**
 * @module tests/e2e/mcp_install_test
 *
 * End-to-end tests for `markspec mcp install`. Exercises the
 * mcp_orchestrator wiring — JSON managed-block writes, idempotence,
 * --print, --remove, non-TTY safety, vscode verify-only path, and
 * Q5 parity (no `code --install-extension`).
 *
 * The `markspec()` helper spawns the CLI as a subprocess with piped
 * stdin, so `Deno.stdin.isTerminal()` returns false — non-TTY
 * branch is exercised by default unless `--force` is passed.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { markspec } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Test 1: --print emits full file to stdout, "would write to" to stderr
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --print emits full file to stdout, would-write to stderr",
  async () => {
    const { code, stdout, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=claude-desktop",
        "--print",
        "--binary-path=markspec",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, '"mcpServers"');
    assertStringIncludes(stdout, '"markspec"');
    assertStringIncludes(stdout, '"command": "markspec"');
    assertStringIncludes(stdout, '"args"');
    assertStringIncludes(stderr, "would write to ");
    assertStringIncludes(
      stderr.replaceAll("\\", "/"),
      "claude_desktop_config.json",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 2: unknown client suggests correction
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install: unknown client suggests correction",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=claude-desktp", "--print"],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "unknown client 'claude-desktp'");
    assertStringIncludes(stderr, "did you mean: claude-desktop");
  },
);

// ---------------------------------------------------------------------------
// Test 3: non-TTY without --force → exit 1 with remediation hint
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: non-TTY without --force → exit 1 with remediation",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=claude-desktop", "--binary-path=markspec"],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "non-interactive");
    assertStringIncludes(stderr, "--force");
    // The message must not appear doubled (formatting regression guard)
    assert(!stderr.includes("\n\nerror: non-interactive"));
  },
);

// ---------------------------------------------------------------------------
// Test 4: --scope=workspace rejected for claude-desktop
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --scope=workspace → exit 1 (per-user app)",
  async () => {
    const { code, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=claude-desktop",
        "--scope=workspace",
        "--print",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "--scope=workspace is not supported");
    assertStringIncludes(stderr, "claude-desktop");
  },
);

// ---------------------------------------------------------------------------
// Test 5: vscode never emits `code --install-extension` (spec §8 Q5)
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install vscode: never suggests `code --install-extension` (parity with spec §8 Q5)",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=vscode"],
      { permissions: ["--allow-env", "--allow-run"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stderr, "driftsys.markspec-ide");
    assertEquals(
      stderr.includes("code --install-extension"),
      false,
      "stderr must never suggest `code --install-extension`",
    );
  },
);

// ---------------------------------------------------------------------------
// Direct subprocess helper — for tests that need a controlled HOME dir
// ---------------------------------------------------------------------------

const CLI_ENTRY = fromFileUrl(
  new URL("../../packages/markspec/main.ts", import.meta.url),
);

async function runMcpInstallE2e(
  args: string[],
  homeDir: string,
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Inherit the parent environment so Windows-specific vars
  // (SYSTEMROOT, TMP, PATH, …) reach the subprocess — Deno needs them
  // to function on Windows. Strip GIT_* like the shared helper does.
  // Then override HOME / USERPROFILE / APPDATA to point at the temp
  // dir so the orchestrator writes there instead of the real user
  // config locations. Pass `cwd` to anchor workspace-scoped writes
  // (e.g. copilot's .github/mcp.json) to a temp repo dir the caller
  // owns and can read back / clean up.
  const parentEnv = Deno.env.toObject();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (!k.startsWith("GIT_")) env[k] = v;
  }
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  env.APPDATA = join(homeDir, "AppData", "Roaming");
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      CLI_ENTRY,
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env,
  });
  const result = await cmd.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function expectedConfigPath(homeDir: string): string {
  if (Deno.build.os === "darwin") {
    return join(
      homeDir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (Deno.build.os === "windows") {
    return join(
      homeDir,
      "AppData",
      "Roaming",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  return join(homeDir, ".config", "Claude", "claude_desktop_config.json");
}

// ---------------------------------------------------------------------------
// Test 6: --force writes managed entry; re-run is no-op (idempotence)
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --force writes managed entry; re-run is no-op",
  async () => {
    const homeDir = await Deno.makeTempDir();
    try {
      const first = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=/opt/markspec/markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(first.code, 0, first.stderr);
      assertStringIncludes(first.stderr, "wrote ");

      const configPath = expectedConfigPath(homeDir);
      const written = await Deno.readTextFile(configPath);
      const parsed = JSON.parse(written);
      assertEquals(
        parsed.mcpServers.markspec.command,
        "/opt/markspec/markspec",
      );
      assertEquals(parsed.mcpServers.markspec.args, ["mcp"]);

      // Second run with identical args must be a no-op.
      const second = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=/opt/markspec/markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(second.code, 0, second.stderr);
      assertStringIncludes(second.stderr, "already up to date");
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 7: preserves sibling keys and JSONC comments
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: preserves sibling keys and JSONC comments",
  async () => {
    const homeDir = await Deno.makeTempDir();
    try {
      const configPath = expectedConfigPath(homeDir);
      const configDir = dirname(configPath);
      await Deno.mkdir(configDir, { recursive: true });
      const initial = `{
  // top comment
  "mcpServers": {
    "other-server": { "command": "other", "args": ["run"] }
  },
  /* block */ "globalShortcut": "Cmd+Space"
}
`;
      await Deno.writeTextFile(configPath, initial);

      const r = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(r.code, 0, r.stderr);

      const written = await Deno.readTextFile(configPath);
      assertStringIncludes(written, "// top comment");
      assertStringIncludes(written, "/* block */");
      assertStringIncludes(written, '"other-server"');
      assertStringIncludes(written, '"globalShortcut"');
      assertStringIncludes(written, '"markspec"');
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test: claude-code --print emits JSON for .mcp.json
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-code: --print emits JSON for .mcp.json",
  async () => {
    const { code, stdout, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=claude-code",
        "--scope=workspace",
        "--print",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, '"mcpServers"');
    assertStringIncludes(stdout, '"markspec"');
    assertStringIncludes(stderr.replaceAll("\\", "/"), ".mcp.json");
  },
);

// ---------------------------------------------------------------------------
// Test: claude-code --force writes .mcp.json
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-code: --force writes .mcp.json",
  async () => {
    const { code, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=claude-code",
        "--scope=workspace",
        "--force",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stderr.replaceAll("\\", "/"), ".mcp.json");
  },
);

// ---------------------------------------------------------------------------
// Test: opencode --print emits JSON for opencode.json
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install opencode: --print emits JSON for opencode.json",
  async () => {
    const { code, stdout, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=opencode",
        "--scope=workspace",
        "--print",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    // Verified opencode shape — flat `mcp.markspec`, no `mcpServers` nesting.
    assertStringIncludes(stdout, '"mcp"');
    assertStringIncludes(stdout, '"markspec"');
    assertStringIncludes(stderr.replaceAll("\\", "/"), "opencode.json");
  },
);

// ---------------------------------------------------------------------------
// Test: opencode --force writes opencode.json
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install opencode: --force writes opencode.json",
  async () => {
    const { code, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=opencode",
        "--scope=workspace",
        "--force",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    // Verified opencode path: opencode.json at project root.
    assertStringIncludes(stderr.replaceAll("\\", "/"), "opencode.json");
  },
);

// ---------------------------------------------------------------------------
// Test 8: --remove strips only the markspec entry; re-remove is no-op
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --remove strips only the markspec entry",
  async () => {
    const homeDir = await Deno.makeTempDir();
    try {
      // First: install to create the entry.
      await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=markspec",
          "--force",
        ],
        homeDir,
      );

      // Remove it.
      const r = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--remove",
          "--force",
        ],
        homeDir,
      );
      assertEquals(r.code, 0, r.stderr);
      assertStringIncludes(r.stderr, "wrote ");

      const configPath = expectedConfigPath(homeDir);
      const written = await Deno.readTextFile(configPath);
      const parsed = JSON.parse(written);
      assertEquals(parsed.mcpServers?.markspec, undefined);

      // Re-remove must be a no-op.
      const second = await runMcpInstallE2e(
        ["mcp", "install", "--client=claude-desktop", "--remove", "--force"],
        homeDir,
      );
      assertEquals(second.code, 0, second.stderr);
      assertStringIncludes(second.stderr, "already removed");
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// copilot (#635) — dual-scope client. Workspace → .github/mcp.json,
// user → ~/.copilot/mcp-config.json. Schema adds type:"local" + tools:["*"].
// ---------------------------------------------------------------------------

/** Copilot user-scope config path under an overridden HOME. */
function copilotUserConfigPath(homeDir: string): string {
  return join(homeDir, ".copilot", "mcp-config.json");
}

Deno.test(
  "mcp install copilot: --scope=workspace --print emits type+tools for .github/mcp.json",
  async () => {
    const { code, stdout, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=copilot",
        "--scope=workspace",
        "--print",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, '"mcpServers"');
    assertStringIncludes(stdout, '"markspec"');
    assertStringIncludes(stdout, '"type": "local"');
    assertStringIncludes(stdout, '"tools"');
    assertStringIncludes(stderr.replaceAll("\\", "/"), ".github/mcp.json");
    assertStringIncludes(stderr, "would write to ");
  },
);

Deno.test(
  "mcp install copilot: --scope=user --print targets ~/.copilot/mcp-config.json",
  async () => {
    // Override HOME to a fresh temp dir so the print reads no pre-existing
    // ~/.copilot/mcp-config.json (which would trigger the idempotence
    // no-op and emit empty stdout on a machine that already has markspec
    // wired into Copilot).
    const homeDir = await Deno.makeTempDir();
    try {
      const { code, stdout, stderr } = await runMcpInstallE2e(
        ["mcp", "install", "--client=copilot", "--scope=user", "--print"],
        homeDir,
      );
      assertEquals(code, 0, stderr);
      assertStringIncludes(stdout, '"type": "local"');
      assertStringIncludes(
        stderr.replaceAll("\\", "/"),
        ".copilot/mcp-config.json",
      );
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "mcp install copilot: no --scope defaults to workspace (.github/mcp.json)",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=copilot", "--print"],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stderr.replaceAll("\\", "/"), ".github/mcp.json");
  },
);

Deno.test(
  "mcp install copilot: --scope=workspace --force writes .github/mcp.json",
  async () => {
    const { code, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=copilot",
        "--scope=workspace",
        "--force",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0, stderr);
    assertStringIncludes(stderr.replaceAll("\\", "/"), ".github/mcp.json");
    assertStringIncludes(stderr, "wrote ");
  },
);

Deno.test(
  "mcp install copilot: --scope=user write merges (not clobbers), is idempotent, and removes",
  async () => {
    const homeDir = await Deno.makeTempDir();
    try {
      const configPath = copilotUserConfigPath(homeDir);
      // Pre-seed a sibling server so we prove managed-entry merge, not clobber.
      await Deno.mkdir(dirname(configPath), { recursive: true });
      await Deno.writeTextFile(
        configPath,
        JSON.stringify(
          { mcpServers: { other: { type: "local", command: "other" } } },
          null,
          2,
        ),
      );

      const install = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=copilot",
          "--scope=user",
          "--binary-path=markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(install.code, 0, install.stderr);
      assertStringIncludes(install.stderr, "wrote ");

      const parsed = JSON.parse(await Deno.readTextFile(configPath));
      // Sibling survives (merge, not clobber).
      assertEquals(parsed.mcpServers.other.command, "other");
      // Managed entry carries the Copilot local schema.
      assertEquals(parsed.mcpServers.markspec, {
        type: "local",
        command: "markspec",
        args: ["mcp"],
        tools: ["*"],
      });

      // Re-install is a no-op.
      const again = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=copilot",
          "--scope=user",
          "--binary-path=markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(again.code, 0, again.stderr);
      assertStringIncludes(again.stderr, "already up to date");

      // Remove strips only the markspec entry.
      const removed = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=copilot",
          "--scope=user",
          "--remove",
          "--force",
        ],
        homeDir,
      );
      assertEquals(removed.code, 0, removed.stderr);
      assertStringIncludes(removed.stderr, "wrote ");
      const afterRemove = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(afterRemove.mcpServers.markspec, undefined);
      assertEquals(afterRemove.mcpServers.other.command, "other");
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "mcp install copilot: --scope=workspace write verifies content, preserves top-level + sibling keys, and removes",
  async () => {
    const repoDir = await Deno.makeTempDir();
    const homeDir = await Deno.makeTempDir();
    try {
      const configPath = join(repoDir, ".github", "mcp.json");
      // Pre-seed a top-level sibling ($schema) AND a sibling server so we
      // prove neither is clobbered by the managed-entry write.
      await Deno.mkdir(dirname(configPath), { recursive: true });
      await Deno.writeTextFile(
        configPath,
        JSON.stringify(
          {
            $schema: "https://example.invalid/copilot.schema.json",
            mcpServers: { other: { type: "local", command: "other" } },
          },
          null,
          2,
        ),
      );

      const install = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=copilot",
          "--scope=workspace",
          "--binary-path=markspec",
          "--force",
        ],
        homeDir,
        repoDir,
      );
      assertEquals(install.code, 0, install.stderr);
      assertStringIncludes(install.stderr, "wrote ");

      const parsed = JSON.parse(await Deno.readTextFile(configPath));
      // Top-level sibling and server sibling both survive (merge, not clobber).
      assertEquals(
        parsed.$schema,
        "https://example.invalid/copilot.schema.json",
      );
      assertEquals(parsed.mcpServers.other.command, "other");
      // Managed entry carries the exact Copilot local schema (strong check,
      // not a substring).
      assertEquals(parsed.mcpServers.markspec, {
        type: "local",
        command: "markspec",
        args: ["mcp"],
        tools: ["*"],
      });

      // Remove strips only the markspec entry from the workspace file.
      const removed = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=copilot",
          "--scope=workspace",
          "--remove",
          "--force",
        ],
        homeDir,
        repoDir,
      );
      assertEquals(removed.code, 0, removed.stderr);
      assertStringIncludes(removed.stderr, "wrote ");
      const afterRemove = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(afterRemove.mcpServers.markspec, undefined);
      assertEquals(
        afterRemove.$schema,
        "https://example.invalid/copilot.schema.json",
      );
      assertEquals(afterRemove.mcpServers.other.command, "other");
    } finally {
      await Deno.remove(repoDir, { recursive: true });
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

Deno.test(
  "mcp install copilot: non-TTY without --force → exit 1 with remediation",
  async () => {
    // The shared markspec() helper pipes stdin, so the subprocess is
    // non-TTY. Without --force (and without --print) the dual-scope
    // resolution must still fall through to the non-TTY abort.
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=copilot", "--scope=workspace"],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "--force");
  },
);

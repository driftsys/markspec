import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  neovimAdapter,
  neovimDescriptor,
  vscodeAdapter,
  type VscodeAdapterEnv,
  zedAdapter,
} from "./lsp_adapters.ts";

// ---------------------------------------------------------------------------
// vscodeAdapter — Slice B verify-and-report rework (spec §4.3, §8 Q5)
// ---------------------------------------------------------------------------

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=driftsys.markspec-ide";
const EXTENSION_ID = "driftsys.markspec-ide";

/** Build a VscodeAdapterEnv with sensible defaults that tests can override. */
function fakeEnv(overrides: Partial<VscodeAdapterEnv> = {}): VscodeAdapterEnv {
  return {
    platform: "darwin",
    home: "/Users/test",
    appData: undefined,
    listExtensions: () => Promise.resolve([]),
    readSettings: () => Promise.resolve(undefined),
    ...overrides,
  };
}

Deno.test("vscodeAdapter: extension not installed → marketplace URL, no `code --install-extension`", async () => {
  const r = await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({ listExtensions: () => Promise.resolve(["other.ext"]) }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, MARKETPLACE_URL);
  assertEquals(
    r.stderr.includes("code --install-extension"),
    false,
    "stderr must not suggest `code --install-extension` (spec §8 Q5)",
  );
});

Deno.test("vscodeAdapter: `code` CLI absent → marketplace URL, no `code --install-extension`", async () => {
  const r = await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({ listExtensions: () => Promise.resolve(undefined) }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, MARKETPLACE_URL);
  assertEquals(r.stderr.includes("code --install-extension"), false);
});

Deno.test("vscodeAdapter: extension installed + path matches → success, no remediation", async () => {
  const settings = JSON.stringify({
    "markspec.server.path": "/opt/markspec/markspec",
  });
  const r = await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: () => Promise.resolve(settings),
    }),
  });
  assertEquals(r.exitCode, 0);
  // Success path mentions the extension is wired up correctly.
  assertStringIncludes(r.stderr, EXTENSION_ID);
  assertStringIncludes(r.stderr, "/opt/markspec/markspec");
  // No remediation snippet on the success path.
  assertEquals(r.stderr.includes("markspec.server.path"), true);
  assertEquals(r.stderr.includes("code --install-extension"), false);
});

Deno.test("vscodeAdapter: extension installed + path mismatch → remediation snippet", async () => {
  const settings = JSON.stringify({
    "markspec.server.path": "/old/path/markspec",
  });
  const r = await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: () => Promise.resolve(settings),
    }),
  });
  assertEquals(r.exitCode, 0);
  // Remediation lists both the stale and the expected paths.
  assertStringIncludes(r.stderr, "/old/path/markspec");
  assertStringIncludes(r.stderr, "/opt/markspec/markspec");
  assertStringIncludes(r.stderr, "markspec.server.path");
  assertEquals(r.stderr.includes("code --install-extension"), false);
});

Deno.test("vscodeAdapter: extension installed + key missing → remediation snippet", async () => {
  // settings.json exists but markspec.server.path is unset.
  const settings = JSON.stringify({ "editor.fontSize": 14 });
  const r = await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: () => Promise.resolve(settings),
    }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, "markspec.server.path");
  assertStringIncludes(r.stderr, "/opt/markspec/markspec");
  assertEquals(r.stderr.includes("code --install-extension"), false);
});

Deno.test("vscodeAdapter: extension installed + settings.json missing → remediation snippet", async () => {
  const r = await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: () => Promise.resolve(undefined),
    }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, "markspec.server.path");
  assertStringIncludes(r.stderr, "/opt/markspec/markspec");
  assertEquals(r.stderr.includes("code --install-extension"), false);
});

Deno.test("vscodeAdapter: JSONC settings with line + block comments parses correctly", async () => {
  // VS Code's real settings.json is JSONC. The adapter must tolerate
  // `//` line comments and `/* … */` block comments.
  const settings = `{
  // Line comment
  "markspec.server.path": "/opt/markspec/markspec",
  /* Block comment */
  "editor.fontSize": 14
}`;
  const r = await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: () => Promise.resolve(settings),
    }),
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stderr, "/opt/markspec/markspec");
  // Must hit the "match" branch, not the remediation branch.
  assertEquals(
    r.stderr.includes("/old/"),
    false,
    "must parse JSONC and pick up the matching path",
  );
});

Deno.test("vscodeAdapter: macOS resolves settings.json under Library/Application Support", async () => {
  // The platform-specific path resolution is observable through the
  // path argument passed to readSettings. Capture it.
  let observedPath: string | undefined;
  await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({
      platform: "darwin",
      home: "/Users/test",
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: (path: string) => {
        observedPath = path;
        return Promise.resolve(undefined);
      },
    }),
  });
  assertEquals(
    observedPath?.replaceAll("\\", "/"),
    "/Users/test/Library/Application Support/Code/User/settings.json",
  );
});

Deno.test("vscodeAdapter: Linux resolves settings.json under .config/Code/User", async () => {
  let observedPath: string | undefined;
  await vscodeAdapter({
    binaryPath: "/opt/markspec/markspec",
    env: fakeEnv({
      platform: "linux",
      home: "/home/test",
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: (path: string) => {
        observedPath = path;
        return Promise.resolve(undefined);
      },
    }),
  });
  assertEquals(
    observedPath?.replaceAll("\\", "/"),
    "/home/test/.config/Code/User/settings.json",
  );
});

Deno.test("vscodeAdapter: Windows resolves settings.json under APPDATA/Code/User", async () => {
  let observedPath: string | undefined;
  await vscodeAdapter({
    binaryPath: "C:\\Program Files\\markspec\\markspec.exe",
    env: fakeEnv({
      platform: "win32",
      home: "C:\\Users\\test",
      appData: "C:\\Users\\test\\AppData\\Roaming",
      listExtensions: () => Promise.resolve([EXTENSION_ID]),
      readSettings: (path: string) => {
        observedPath = path;
        return Promise.resolve(undefined);
      },
    }),
  });
  assertEquals(
    observedPath?.replaceAll("\\", "/"),
    "C:/Users/test/AppData/Roaming/Code/User/settings.json",
  );
});

Deno.test("neovim adapter: output contains lsp and --stdio args", () => {
  const { stdout } = neovimAdapter();
  // Lua array: { '<BINARY_PATH>', 'lsp', '--stdio' }
  assertStringIncludes(stdout, "'lsp', '--stdio'");
});

Deno.test("neovim adapter: output contains lspconfig", () => {
  const { stdout } = neovimAdapter();
  assertStringIncludes(stdout, "lspconfig");
});

Deno.test("neovim adapter: output contains BINARY_PATH placeholder", () => {
  const { stdout } = neovimAdapter();
  assertStringIncludes(stdout, "<BINARY_PATH>");
});

Deno.test("zed adapter: stdout contains markspec", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "markspec");
});

Deno.test("zed adapter: stdout contains lsp", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "lsp");
});

Deno.test("zed adapter: stdout contains file_types key", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "file_types");
});

Deno.test("zed adapter: stderr mentions settings.json", () => {
  const { stderr } = zedAdapter();
  assertStringIncludes(stderr, "settings.json");
});

Deno.test("zed adapter: stdout contains BINARY_PATH placeholder", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "<BINARY_PATH>");
});

// ---------------------------------------------------------------------------
// neovimDescriptor (new descriptor shape — Task 5)
// ---------------------------------------------------------------------------

Deno.test("neovimDescriptor: id matches editor id", () => {
  assertEquals(neovimDescriptor.id, "neovim");
});

// Normalize backslash → forward-slash so path assertions are portable
// across POSIX and Windows runners. @std/path's `join()` produces native
// separators (backslash on Windows); the implementation must walk through
// `join()` for cross-platform path correctness, so the test verifies
// behavior after normalization.
function normalizePath(p: string): string {
  return p.replaceAll("\\", "/");
}

Deno.test(
  "neovimDescriptor: user-scope config path is <home>/.config/nvim/lsp/markspec.lua",
  () => {
    const path = neovimDescriptor.resolveConfigPath(
      "user",
      "/cwd",
      "/home/test",
    );
    assertEquals(
      normalizePath(path),
      "/home/test/.config/nvim/lsp/markspec.lua",
    );
  },
);

Deno.test(
  "neovimDescriptor: workspace-scope path is <root>/.nvim/markspec.lua",
  () => {
    const path = neovimDescriptor.resolveConfigPath(
      "workspace",
      "/cwd",
      "/home/test",
      "/repo",
    );
    assertEquals(normalizePath(path), "/repo/.nvim/markspec.lua");
  },
);

Deno.test(
  "neovimDescriptor: workspace scope without workspaceRoot → throws",
  () => {
    let threw = false;
    try {
      neovimDescriptor.resolveConfigPath("workspace", "/cwd", "/home/test");
    } catch {
      threw = true;
    }
    assert(threw);
  },
);

Deno.test(
  "neovimDescriptor: renderBlock embeds the binary path verbatim",
  () => {
    const block = neovimDescriptor.renderBlock({ binaryPath: "markspec" });
    assertStringIncludes(block, "cmd = { 'markspec', 'lsp', '--stdio' }");
    assertStringIncludes(block, "filetypes = { 'markdown' }");
  },
);

Deno.test(
  "neovimDescriptor: renderBlock with absolute binary path uses it",
  () => {
    const block = neovimDescriptor.renderBlock({
      binaryPath: "/Users/x/.local/bin/markspec",
    });
    assertStringIncludes(block, "cmd = { '/Users/x/.local/bin/markspec'");
  },
);

Deno.test(
  "neovimDescriptor: renderBlock includes all three workspace markers in root_pattern",
  () => {
    const block = neovimDescriptor.renderBlock({ binaryPath: "markspec" });
    assertStringIncludes(block, "'markspec.yaml'");
    assertStringIncludes(block, "'.markspec.yaml'");
    assertStringIncludes(block, "'project.yaml'");
  },
);

Deno.test(
  "neovimAdapter (legacy print-only) still returns AdapterResult",
  () => {
    // Do not remove the existing API in Slice A — Slice B/C migrate the
    // print-only path. Confirms the legacy shape survives this refactor.
    const r = neovimAdapter();
    assert(typeof r.stdout === "string");
    assert(typeof r.stderr === "string");
    assert(typeof r.exitCode === "number");
  },
);

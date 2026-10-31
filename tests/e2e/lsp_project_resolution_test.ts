/**
 * @module tests/e2e/lsp_project_resolution_test
 *
 * E2E tests for per-document project resolution in the LSP server.
 *
 * - #840: the workspace root is a parent folder that holds several
 *   MarkSpec projects in subfolders. Each document must be validated
 *   against the profile of its own nearest `.markspec.yaml`.
 * - #694: the workspace root is below the folder that holds
 *   `.markspec.yaml`, and there is no `project.yaml`. The server must walk
 *   up from the workspace root to find the profile.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

/** A local profile that declares one profile-level text attribute and a
 * `requirement` type with the `REQ_{n:04d}` display-ID pattern (so the
 * block-scaffold completion can mint the next number per project). */
function profileDeclaring(id: string, attribute: string): string {
  return `id: "@acme/${id}"
version: 0.1.0
markspec-schema: "1"
profile:
  attributes:
    - name: ${attribute}
      type: text
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_{n:04d}"
`;
}

/** One entry block that carries the given trailer attribute line. Each
 * file in one project needs its own `Id:` value, so the last ULID
 * character is passed in. */
function entryUsing(
  displayId: string,
  attributeLine: string,
  idSuffix = "F",
  title = "A requirement",
): string {
  return `# Requirements

- [${displayId}] ${title}

  The system shall work.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE${idSuffix}
      ${attributeLine}
`;
}

/** The duplicate display-ID / duplicate Id diagnostic codes. */
const DUPLICATE_CODES = new Set([
  "MSL-R005",
  "MSL-R006",
  "MSL-I007",
  "MSL-I008",
]);

function codesOf(
  diagnostics: Array<{ code?: string; message: string }>,
): string[] {
  return diagnostics.map((d) => d.code ?? "");
}

function uriOf(client: LspTestClient, relPath: string): string {
  return toFileUrl(join(client.workDir, ...relPath.split("/"))).href;
}

/**
 * Workspace with two sibling projects. The workspace root is itself a
 * MarkSpec project (bundled default profile) so that a double index of a
 * nested project's files would show up as a duplicate display ID against
 * `root.md`. Project `a` declares `Alpha`; project `b` declares `Beta`.
 */
const SIBLING_FILES: Record<string, string> = {
  ".markspec.yaml": "profiles: []\n",
  "root.md": entryUsing("REQ_0001", "Labels: root", "F", "Root requirement"),
  "a/.markspec.yaml": "profiles:\n  - ./profiles/pa\n",
  "a/profiles/pa/markspec.yaml": profileDeclaring("pa", "Alpha"),
  "a/profiles/pg/markspec.yaml": profileDeclaring("pg", "Gamma"),
  "a/req.md": entryUsing(
    "REQ_0001",
    "Alpha: alpha value",
    "F",
    "Alpha requirement",
  ),
  "a/cross.md": entryUsing("REQ_0002", "Beta: beta value", "G"),
  "b/.markspec.yaml": "profiles:\n  - ./profiles/pb\n",
  "b/profiles/pb/markspec.yaml": profileDeclaring("pb", "Beta"),
  "b/req.md": entryUsing(
    "REQ_0001",
    "Beta: beta value",
    "F",
    "Beta requirement",
  ),
};

Deno.test("lsp project resolution: sibling projects each use their own profile (#840)", async () => {
  const client = await LspTestClient.create(SIBLING_FILES);
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);

    const aReq = client.latestDiagnosticsFor(uriOf(client, "a/req.md"));
    assertExists(aReq, "no diagnostics published for a/req.md");
    assertEquals(
      codesOf(aReq).filter((c) => c === "MSL-R010"),
      [],
      `a/req.md must not report MSL-R010: ${JSON.stringify(aReq)}`,
    );

    const bReq = client.latestDiagnosticsFor(uriOf(client, "b/req.md"));
    assertExists(bReq, "no diagnostics published for b/req.md");
    assertEquals(
      codesOf(bReq).filter((c) => c === "MSL-R010"),
      [],
      `b/req.md must not report MSL-R010: ${JSON.stringify(bReq)}`,
    );

    // `Beta` is declared only by project b's profile.
    const aCross = client.latestDiagnosticsFor(uriOf(client, "a/cross.md"));
    assertExists(aCross, "no diagnostics published for a/cross.md");
    assert(
      aCross.some((d) => d.code === "MSL-R010" && d.message.includes("Beta")),
      `a/cross.md must report MSL-R010 for Beta: ${JSON.stringify(aCross)}`,
    );

    // REQ_0001 is declared once per project. A file indexed by two
    // projects would produce a duplicate diagnostic.
    for (const rel of ["root.md", "a/req.md", "b/req.md"]) {
      const diags = client.latestDiagnosticsFor(uriOf(client, rel)) ?? [];
      assertEquals(
        codesOf(diags).filter((c) => DUPLICATE_CODES.has(c)),
        [],
        `${rel} must not report a duplicate: ${JSON.stringify(diags)}`,
      );
    }
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp project resolution: workspace root below .markspec.yaml finds the profile (#694)", async () => {
  const client = await LspTestClient.create({
    "proj/.markspec.yaml": "profiles:\n  - ./profiles/pa\n",
    "proj/profiles/pa/markspec.yaml": profileDeclaring("pa", "Alpha"),
    "proj/docs/req.md": entryUsing("REQ_0001", "Alpha: alpha value"),
  });
  try {
    await client.initialize({ rootSubdir: "proj/docs" });
    await client.waitForNotification("markspec/indexed", 15000);

    const diags = client.latestDiagnosticsFor(
      uriOf(client, "proj/docs/req.md"),
    );
    assertExists(diags, "no diagnostics published for proj/docs/req.md");
    assertEquals(
      codesOf(diags).filter((c) => c === "MSL-R010"),
      [],
      `proj/docs/req.md must not report MSL-R010: ${JSON.stringify(diags)}`,
    );
  } finally {
    await client.shutdown();
  }
});

interface ProfileResponse {
  chain: Array<{ name: string }>;
  effective: { name: string };
}

/** `true` when `diags` holds an MSL-R010 naming `attribute`. */
function hasR010For(
  diags: Array<{ code?: string; message: string }> | undefined,
  attribute: string,
): boolean {
  return (diags ?? []).some((d) =>
    d.code === "MSL-R010" && d.message.includes(`'${attribute}'`)
  );
}

Deno.test("lsp project resolution: markspec/profile answers for the project of the given uri", async () => {
  const client = await LspTestClient.create(SIBLING_FILES);
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);

    const forA = await client.request("markspec/profile", {
      uri: uriOf(client, "a/req.md"),
    }) as ProfileResponse;
    assertEquals(forA.effective.name, "@acme/pa");

    const forB = await client.request("markspec/profile", {
      uri: uriOf(client, "b/req.md"),
    }) as ProfileResponse;
    assertEquals(forB.effective.name, "@acme/pb");

    // Without a uri the primary (workspace-root) project answers: the
    // bundled default profile, not either nested one.
    const primary = await client.request(
      "markspec/profile",
      {},
    ) as ProfileResponse;
    assert(primary.chain.length >= 1);
    assert(
      !["@acme/pa", "@acme/pb"].includes(primary.effective.name),
      `primary must not report a nested profile: ${primary.effective.name}`,
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp project resolution: workspace/symbol and markspec/indexed cover every project", async () => {
  const client = await LspTestClient.create(SIBLING_FILES);
  try {
    await client.initialize();
    const indexed = await client.waitForNotification(
      "markspec/indexed",
      15000,
    );
    // root.md, a/req.md, a/cross.md, b/req.md — one entry each.
    assertEquals(indexed.params, { files: 4, entries: 4 });

    const symbols = await client.request("workspace/symbol", {
      query: "REQ_0001",
    }) as Array<{ name: string; location: { uri: string } }>;
    const uris = symbols.map((s) => s.location.uri).sort();
    assertEquals(
      uris,
      ["a/req.md", "b/req.md", "root.md"].map((r) => uriOf(client, r)).sort(),
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp project resolution: a nested .markspec.yaml change reloads only that project", async () => {
  const client = await LspTestClient.create({
    ...SIBLING_FILES,
    "a/gamma.md": entryUsing("REQ_0003", "Gamma: gamma value", "H"),
  });
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);
    const gammaUri = uriOf(client, "a/gamma.md");
    const aReqUri = uriOf(client, "a/req.md");
    const bReqUri = uriOf(client, "b/req.md");
    assert(hasR010For(client.latestDiagnosticsFor(gammaUri), "Gamma"));
    assert(!hasR010For(client.latestDiagnosticsFor(aReqUri), "Alpha"));
    const bPublishesBefore = client.publishCountFor(bReqUri);

    // Switch project a to a profile that declares Gamma instead of Alpha.
    const markspecYaml = join(client.workDir, "a", ".markspec.yaml");
    await Deno.writeTextFile(markspecYaml, "profiles:\n  - ./profiles/pg\n");
    await client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: toFileUrl(markspecYaml).href, type: 2 }],
    });

    const changed = await client.waitForNotification(
      "markspec/profileChanged",
      5000,
    );
    assertEquals(
      (changed.params as { root: string }).root,
      toFileUrl(join(client.workDir, "a")).href,
    );
    await client.waitUntil(
      () =>
        !hasR010For(client.latestDiagnosticsFor(gammaUri), "Gamma") &&
        hasR010For(client.latestDiagnosticsFor(aReqUri), "Alpha"),
      "project a diagnostics to follow the new profile",
    );
    // Project b was not reloaded: no new diagnostics were published.
    assertEquals(client.publishCountFor(bReqUri), bPublishesBefore);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp project resolution: creating a .markspec.yaml moves open documents to the new project", async () => {
  const client = await LspTestClient.create({
    "a/profiles/pa/markspec.yaml": profileDeclaring("pa", "Alpha"),
  });
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);

    // A buffer that exists only in the editor, not on disk: after the
    // rebuild only reindexOpenDocuments can bring it into project a.
    const unsavedPath = join(client.workDir, "a", "unsaved.md");
    const unsavedUri = toFileUrl(unsavedPath).href;
    const text = `# Requirements

- [REQ_0001] A requirement

  The system shall work.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Alpha: alpha value
      Zeta: zeta value
`;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: unsavedUri,
        languageId: "markdown",
        version: 1,
        text,
      },
    });
    await client.waitUntil(
      () => hasR010For(client.latestDiagnosticsFor(unsavedUri), "Alpha"),
      "MSL-R010 for Alpha before project a exists",
    );

    const markspecYaml = join(client.workDir, "a", ".markspec.yaml");
    await Deno.writeTextFile(markspecYaml, "profiles:\n  - ./profiles/pa\n");
    await client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: toFileUrl(markspecYaml).href, type: 1 }],
    });

    // Validated by project a: Alpha is declared, Zeta is not.
    await client.waitUntil(
      () => {
        const diags = client.latestDiagnosticsFor(unsavedUri);
        return hasR010For(diags, "Zeta") && !hasR010For(diags, "Alpha");
      },
      "the open buffer to be validated by project a",
      8000,
    );
  } finally {
    await client.shutdown();
  }
});

// ---------------------------------------------------------------------------
// Primary root above the workspace folder: RelativePattern watcher (#694)
// ---------------------------------------------------------------------------

/** #694 layout: the workspace root is `proj/docs`, the profile is in
 * `proj/`. `pa` declares Alpha; `pg` declares Gamma. */
const ABOVE_WORKSPACE_FILES: Record<string, string> = {
  "proj/.markspec.yaml": "profiles:\n  - ./profiles/pa\n",
  "proj/profiles/pa/markspec.yaml": profileDeclaring("pa", "Alpha"),
  "proj/profiles/pg/markspec.yaml": profileDeclaring("pg", "Gamma"),
  "proj/docs/req.md": entryUsing("REQ_0001", "Alpha: alpha value"),
  "proj/docs/gamma.md": entryUsing("REQ_0002", "Gamma: gamma value", "G"),
};

const PRIMARY_ROOT_PATTERN = "{.markspec.yaml,project.yaml,markspec.lock}";

interface Registration {
  registrations: Array<{
    method: string;
    registerOptions?: {
      watchers?: Array<{
        globPattern: string | { baseUri: string; pattern: string };
      }>;
    };
  }>;
}

/** Every RelativePattern (object) glob the server asked the client to
 * watch so far. */
function relativeWatchers(
  client: LspTestClient,
): Array<{ baseUri: string; pattern: string }> {
  const out: Array<{ baseUri: string; pattern: string }> = [];
  for (const params of client.receivedParams("client/registerCapability")) {
    for (const reg of (params as Registration).registrations) {
      for (const watcher of reg.registerOptions?.watchers ?? []) {
        if (typeof watcher.globPattern === "object") {
          out.push(watcher.globPattern);
        }
      }
    }
  }
  return out;
}

Deno.test("lsp project resolution: a primary root above the workspace is watched with a RelativePattern (#694)", async () => {
  const client = await LspTestClient.create(ABOVE_WORKSPACE_FILES);
  try {
    await client.initialize({
      rootSubdir: "proj/docs",
      capabilities: {
        workspace: {
          didChangeWatchedFiles: {
            dynamicRegistration: true,
            relativePatternSupport: true,
          },
        },
      },
      answerServerRequests: true,
    });
    await client.waitForNotification("markspec/indexed", 15000);
    const projUri = toFileUrl(join(client.workDir, "proj")).href;
    await client.waitUntil(
      () => relativeWatchers(client).length > 0,
      "a RelativePattern watcher registration",
    );
    assertEquals(relativeWatchers(client), [
      { baseUri: projUri, pattern: PRIMARY_ROOT_PATTERN },
    ]);

    const reqUri = uriOf(client, "proj/docs/req.md");
    const gammaUri = uriOf(client, "proj/docs/gamma.md");
    assert(!hasR010For(client.latestDiagnosticsFor(reqUri), "Alpha"));
    assert(hasR010For(client.latestDiagnosticsFor(gammaUri), "Gamma"));

    // Switch the project to the profile that declares Gamma instead.
    const markspecYaml = join(client.workDir, "proj", ".markspec.yaml");
    await Deno.writeTextFile(markspecYaml, "profiles:\n  - ./profiles/pg\n");
    await client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: toFileUrl(markspecYaml).href, type: 2 }],
    });
    const changed = await client.waitForNotification(
      "markspec/profileChanged",
      5000,
    );
    assertEquals((changed.params as { root: string }).root, projUri);
    await client.waitUntil(
      () =>
        hasR010For(client.latestDiagnosticsFor(reqUri), "Alpha") &&
        !hasR010For(client.latestDiagnosticsFor(gammaUri), "Gamma"),
      "diagnostics to follow the new profile",
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp project resolution: no RelativePattern watcher without client support", async () => {
  const client = await LspTestClient.create(ABOVE_WORKSPACE_FILES);
  try {
    await client.initialize({
      rootSubdir: "proj/docs",
      capabilities: {
        workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
      },
      answerServerRequests: true,
    });
    await client.waitForNotification("markspec/indexed", 15000);
    // Wait for the server's one-time warning, which proves that the
    // capability check ran and took the "not supported" branch.
    await client.waitUntil(
      () =>
        client.receivedParams("window/logMessage").some((p) =>
          (p as { message: string }).message.includes(
            "does not support relative watch patterns",
          )
        ),
      "the relative-pattern warning",
    );
    assertEquals(relativeWatchers(client), []);
  } finally {
    await client.shutdown();
  }
});

// ---------------------------------------------------------------------------
// Per-project scoping of the navigation and completion handlers
// ---------------------------------------------------------------------------

async function openDocument(
  client: LspTestClient,
  uri: string,
  text: string,
): Promise<void> {
  await client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "markdown", version: 1, text },
  });
}

Deno.test("lsp project resolution: hover, definition, references, rename and completion resolve stay inside the owning project", async () => {
  // `REQ_0001` exists in the root project, in `a` and in `b`, each with its
  // own title. `a/sat.md` references it; `b/more.md` pushes b's next free
  // number to REQ_0006 while the root project's next is REQ_0002.
  const satText = `# Requirements

- [REQ_0003] Satisfying requirement

  The system shall work.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEK
      Satisfies: REQ_0001
`;
  const client = await LspTestClient.create({
    ...SIBLING_FILES,
    "a/sat.md": satText,
    "b/more.md": entryUsing("REQ_0005", "Beta: more", "J"),
  });
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);
    const satUri = uriOf(client, "a/sat.md");
    await openDocument(client, satUri, satText);
    // The `REQ_0001` token on the `Satisfies:` line.
    const position = { line: 7, character: 18 };

    const hover = await client.request("textDocument/hover", {
      textDocument: { uri: satUri },
      position,
    }) as { contents: { value: string } };
    assertStringIncludes(hover.contents.value, "Alpha requirement");

    const definition = await client.request("textDocument/definition", {
      textDocument: { uri: satUri },
      position,
    }) as { uri: string };
    assertEquals(definition.uri, uriOf(client, "a/req.md"));

    const references = await client.request("textDocument/references", {
      textDocument: { uri: satUri },
      position,
      context: { includeDeclaration: true },
    }) as Array<{ uri: string }>;
    assertEquals(
      references.map((r) => r.uri).sort(),
      [uriOf(client, "a/req.md"), satUri].sort(),
    );

    const rename = await client.request("textDocument/rename", {
      textDocument: { uri: satUri },
      position,
      newName: "REQ_0101",
    }) as { changes: Record<string, unknown[]> };
    assertEquals(
      Object.keys(rename.changes).sort(),
      [uriOf(client, "a/req.md"), satUri].sort(),
    );

    // Block scaffold in project b: the minted number comes from b's index.
    const newUri = uriOf(client, "b/new.md");
    await openDocument(client, newUri, "- [");
    const completion = await client.request("textDocument/completion", {
      textDocument: { uri: newUri },
      position: { line: 0, character: 3 },
    }) as Array<{ label: string; data?: unknown }>;
    const scaffold = completion.find((item) => item.data !== undefined);
    assertExists(scaffold, `no scaffold item: ${JSON.stringify(completion)}`);
    const resolved = await client.request(
      "completionItem/resolve",
      scaffold,
    ) as { label: string };
    assertStringIncludes(resolved.label, "REQ_0006");
  } finally {
    await client.shutdown();
  }
});

/** A valid `markspec.lock` with one snapshot-carrying registry upstream
 * named `up`, whose cache lives at `.markspec/cache/upstreams/up/`. */
const LOCK_WITH_UPSTREAM = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-25T12:00:00Z"

[[upstream.registry]]
id = "up"
api = "https://registry.example"
resolved-manifest-hash = "sha256:a"
markspec-schema = 1
version = "1.0.0"
snapshot = "sha256:b"

[generated-cache]
edges-hash = "sha256:0"
edges-count = 0
`;

/** Snapshot cache of the `up` upstream: one entry, `SYS_0001`. The JSON
 * is the compiled-snapshot format (`manifest.json` + inline
 * `compiled.json`) as `markspec lock` writes it. */
const UPSTREAM_MANIFEST =
  `{"markspecSchemaVersion":1,"generator":{"release":"0.0.0-test","coreSchema":1},"project":{"name":"up","root":"/up"},"counts":{"entries":1,"edges":0,"byType":{}},"entries":{"format":"inline","file":"compiled.json"},"edges":{"format":"inline","file":"compiled.json"},"sqliteMirror":null,"federation":[],"reserved":{}}`;
const UPSTREAM_COMPILED =
  `{"entries":{"SYS_0001":{"displayId":"SYS_0001","title":"Upstream requirement","body":"Body.","bodyAst":[{"kind":"paragraph","content":{"text":"Body."},"range":{"start":{"line":1,"column":1},"end":{"line":1,"column":6}}}],"rawAttributes":[{"key":"Id","value":"01HGW2Q8MNP3RSTVWXYZABCDEG"}],"typedAttributes":{"Id":["01HGW2Q8MNP3RSTVWXYZABCDEG"]},"id":"01HGW2Q8MNP3RSTVWXYZABCDEG","shape":"Authored","location":{"file":"/up/a.md","line":1,"column":1},"bodyStartLine":3,"source":{"kind":"markdown"},"properties":{"file":{"path":"/up/a.md","line":1,"column":1}},"bodyTokens":[]}}}`;

Deno.test("lsp project resolution: a markspec.lock change loads the upstream corpus of its own project only", async () => {
  // `a/sat.md` cites the upstream entry. Before the lockfile exists the
  // citation resolves to nothing; after a lock-only change it resolves to
  // the snapshot entry — in project a, not in project b.
  const satText = `# Requirements

- [REQ_0003] Satisfying requirement

  The system shall work.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEK
      Satisfies: SYS_0001
`;
  const client = await LspTestClient.create({
    ...SIBLING_FILES,
    "a/sat.md": satText,
    "b/sat.md": satText,
    "a/.markspec/cache/upstreams/up/manifest.json": UPSTREAM_MANIFEST,
    "a/.markspec/cache/upstreams/up/compiled.json": UPSTREAM_COMPILED,
  });
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);
    const aSatUri = uriOf(client, "a/sat.md");
    const bSatUri = uriOf(client, "b/sat.md");
    await openDocument(client, aSatUri, satText);
    await openDocument(client, bSatUri, satText);
    const position = { line: 7, character: 18 };
    const hoverIn = (uri: string) =>
      client.request("textDocument/hover", {
        textDocument: { uri },
        position,
      }) as Promise<{ contents: { value: string } } | null>;
    assertEquals(await hoverIn(aSatUri), null);
    const bBefore = client.publishCountFor(uriOf(client, "b/req.md"));

    const lockPath = join(client.workDir, "a", "markspec.lock");
    await Deno.writeTextFile(lockPath, LOCK_WITH_UPSTREAM);
    await client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: toFileUrl(lockPath).href, type: 1 }],
    });

    let hover: { contents: { value: string } } | null = null;
    await client.waitUntil(() => {
      hoverIn(aSatUri).then((h) => hover = h);
      return hover !== null;
    }, "the upstream entry to resolve in project a after the lock change");
    assertStringIncludes(
      (hover as unknown as { contents: { value: string } }).contents.value,
      "Upstream requirement",
    );
    // Project b has no lockfile: the same citation stays unresolved, no
    // diagnostics were republished for it, and no profile was re-resolved.
    assertEquals(await hoverIn(bSatUri), null);
    assertEquals(client.publishCountFor(uriOf(client, "b/req.md")), bBefore);
    assertEquals(client.receivedParams("markspec/profileChanged"), []);
  } finally {
    await client.shutdown();
  }
});

/** `count` Markdown files with one entry each, all with distinct display
 * IDs and ULIDs, plus two source files whose doc-comment entries make the
 * startup index load tree-sitter grammars — enough work that the index
 * is still running when the test's document events arrive. */
function bulkFiles(count: number): Record<string, string> {
  const files: Record<string, string> = {
    "src/lib.rs": `/// [BLK_RS0001] Rust requirement
///
/// The system shall work.
///
///     Id: 01HGW2Q8MNP3RSTVWXYZRS0001
pub fn f() {}
`,
    "src/lib.ts": `/** [BLK_TS0001] TypeScript requirement
 *
 * The system shall work.
 *
 *     Id: 01HGW2Q8MNP3RSTVWXYZTS0001
 */
export function f(): void {}
`,
  };
  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(6, "0");
    files[`bulk/f${n}.md`] = `# Bulk

- [BLK_${n}] Bulk requirement ${n}

  The system shall work.

      Id: 01HGW2Q8MNP3RSTVWXYZ${n}
`;
  }
  return files;
}

Deno.test("lsp project resolution: a buffer closed during the startup index does not come back", async () => {
  const client = await LspTestClient.create({
    ".markspec.yaml": "profiles: []\n",
    "req.md": entryUsing("REQ_0001", "Labels: root"),
    ...bulkFiles(400),
  });
  try {
    await client.initialize({ sendInitialized: false });
    // Open a buffer that exists only in the editor while the startup
    // index is still running, let its 50 ms debounced parse reach the
    // startup gate, then close it before the index finishes.
    const ghostUri = uriOf(client, "ghost.md");
    await client.initialized();
    await openDocument(
      client,
      ghostUri,
      entryUsing("REQ_0007", "Zeta: zeta value", "H"),
    );
    await new Promise((r) => setTimeout(r, 120));
    // The test is meaningful only while the startup index is still
    // running: a pass after `markspec/indexed` would not exercise the
    // in-flight parse at all.
    assertEquals(
      client.receivedParams("markspec/indexed"),
      [],
      "startup index finished before didClose; the test proves nothing",
    );
    await client.notify("textDocument/didClose", {
      textDocument: { uri: ghostUri },
    });
    await client.waitForNotification("markspec/indexed", 60000);
    // Let the deferred parse and the 1000ms cross-file validation run.
    await new Promise((r) => setTimeout(r, 1500));

    const symbols = await client.request("workspace/symbol", {
      query: "REQ_0007",
    }) as unknown[];
    assertEquals(symbols, []);
    assertEquals(client.latestDiagnosticsFor(ghostUri) ?? [], []);
  } finally {
    await client.shutdown();
  }
});

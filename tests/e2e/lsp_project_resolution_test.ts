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

import { assert, assertEquals, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

/** A local profile that declares one profile-level text attribute. */
function profileDeclaring(id: string, attribute: string): string {
  return `id: "@acme/${id}"
version: 0.1.0
markspec-schema: "1"
profile:
  attributes:
    - name: ${attribute}
      type: text
`;
}

/** One entry block that carries the given trailer attribute line. Each
 * file in one project needs its own `Id:` value, so the last ULID
 * character is passed in. */
function entryUsing(
  displayId: string,
  attributeLine: string,
  idSuffix = "F",
): string {
  return `# Requirements

- [${displayId}] A requirement

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
  "root.md": entryUsing("REQ_0001", "Labels: root"),
  "a/.markspec.yaml": "profiles:\n  - ./profiles/pa\n",
  "a/profiles/pa/markspec.yaml": profileDeclaring("pa", "Alpha"),
  "a/profiles/pg/markspec.yaml": profileDeclaring("pg", "Gamma"),
  "a/req.md": entryUsing("REQ_0001", "Alpha: alpha value"),
  "a/cross.md": entryUsing("REQ_0002", "Beta: beta value", "G"),
  "b/.markspec.yaml": "profiles:\n  - ./profiles/pb\n",
  "b/profiles/pb/markspec.yaml": profileDeclaring("pb", "Beta"),
  "b/req.md": entryUsing("REQ_0001", "Beta: beta value"),
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

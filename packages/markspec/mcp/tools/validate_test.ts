/**
 * @module mcp/tools/validate_test
 *
 * Unit tests for the validate tool's Markdown report.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { mergeChain, parseManifest } from "../../core/mod.ts";
import type {
  CompileResult,
  Diagnostic,
  ProfileChain,
} from "../../core/mod.ts";
import type { LoadedProfile } from "../../core/model/mod.ts";
import type { Project } from "../project.ts";
import { filterDiagnostics, renderDiagnosticsReport } from "./validate.ts";
import { registerTools } from "./mod.ts";

const ERR: Diagnostic = {
  code: "MSL-R004",
  severity: "error",
  message: "unresolved reference: SYS_NONEXISTENT",
  location: {
    file: "/proj/docs/req.md",
    line: 128,
    column: 3,
  },
};

const WARN: Diagnostic = {
  code: "MSL-R010",
  severity: "warning",
  message: "unrecognized attribute Priority",
  location: { file: "/proj/docs/req.md", line: 200, column: 3 },
};

Deno.test("renderDiagnosticsReport: clean report", () => {
  const md = renderDiagnosticsReport([], "@org/x@1.0.0", 100);
  assertStringIncludes(md, "✓ All 100 entries pass validation");
});

Deno.test("renderDiagnosticsReport: errors and warnings sections", () => {
  const md = renderDiagnosticsReport([ERR, WARN], null, 1);
  assertStringIncludes(md, "# Validation: 1 error, 1 warning");
  assertStringIncludes(md, "## Errors");
  assertStringIncludes(md, "### MSL-R004");
  assertStringIncludes(md, "unresolved reference: SYS_NONEXISTENT");
  assertStringIncludes(md, "/proj/docs/req.md:128:3");
  assertStringIncludes(md, "## Warnings");
  assertStringIncludes(md, "### MSL-R010");
});

Deno.test(
  "renderDiagnosticsReport: renders locations relative to projectRoot",
  () => {
    const proj = resolve("/proj");
    const err: Diagnostic = {
      ...ERR,
      location: { ...ERR.location!, file: join(proj, "docs", "req.md") },
    };
    const warn: Diagnostic = {
      ...WARN,
      location: { ...WARN.location!, file: join(proj, "docs", "req.md") },
    };
    const md = renderDiagnosticsReport([err, warn], null, 1, proj);
    const expected = `${join("docs", "req.md")}:128:3`;
    assertStringIncludes(md, expected);
    assertStringIncludes(md.split("\n").join(" "), ` ${expected}`);
  },
);

Deno.test("renderDiagnosticsReport: scrubs projectRoot from embedded message paths", () => {
  const dup: Diagnostic = {
    code: "MSL-R006",
    severity: "error",
    message:
      "duplicate display ID 'STK_AEB_0001' (also at /proj/docs/other.md:12)",
    location: { file: "/proj/docs/req.md", line: 5, column: 1 },
  };
  const md = renderDiagnosticsReport([dup], null, 1, "/proj");
  assertStringIncludes(
    md,
    "duplicate display ID 'STK_AEB_0001' (also at docs/other.md:12)",
  );
  assertEquals(md.includes("/proj/docs/other.md"), false);
});

Deno.test("filterDiagnostics: passes all when files undefined", () => {
  const out = filterDiagnostics([ERR, WARN], undefined, "/proj");
  assertStringIncludes(out.length.toString(), "2");
});

Deno.test("filterDiagnostics: keeps matching relative path", () => {
  const proj = resolve("/proj");
  const err: Diagnostic = {
    ...ERR,
    location: { ...ERR.location!, file: join(proj, "docs", "req.md") },
  };
  const warn: Diagnostic = {
    ...WARN,
    location: { ...WARN.location!, file: join(proj, "docs", "req.md") },
  };
  const out = filterDiagnostics([err, warn], [join("docs", "req.md")], proj);
  assertStringIncludes(out.length.toString(), "2");
});

Deno.test("filterDiagnostics: drops non-matching paths", () => {
  const out = filterDiagnostics([ERR, WARN], ["docs/other.md"], "/proj");
  assertStringIncludes(out.length.toString(), "0");
});

Deno.test("filterDiagnostics: absolute path match", () => {
  const out = filterDiagnostics([ERR], ["/proj/docs/req.md"], "/proj");
  assertStringIncludes(out.length.toString(), "1");
});

// ---------------------------------------------------------------------------
// validate tool: profile label is the LEAF tier, not the bundled-default root
// ---------------------------------------------------------------------------

/** Build one chain tier from a manifest YAML, mirroring the makeChain
 * helper in profile_describe_test.ts. */
function makeTier(yaml: string): LoadedProfile {
  const result = parseManifest(yaml, "<test>");
  if (!result.manifest) throw new Error("parse failed");
  return {
    id: result.manifest.id,
    version: result.manifest.version,
    specifier: { kind: "local", path: "./test" },
    manifest: result.manifest,
    sourcePath: "<test>",
    baseDir: "/tmp",
  };
}

/** Assemble a multi-tier ProfileChain (root -> leaf) and merge it.
 * mergeChain reads only `.tiers`; the placeholder effective is ignored. */
function makeMultiTierChain(...tiers: LoadedProfile[]): ProfileChain {
  // deno-lint-ignore no-explicit-any
  const merge = mergeChain({ tiers, effective: null as any });
  return { tiers, effective: merge.effective! };
}

const ROOT_DEFAULT_YAML = `
id: "@markspec/profile-default"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    requirement:
      extends: Requirement
      description: A baseline requirement
`;

const LEAF_ACME_YAML = `
id: "@acme/leaf"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    acme-requirement:
      extends: Requirement
      description: An ACME requirement
`;

/** Minimal CompileResult with no diagnostics -- produces the clean report
 * path `OK All N entries pass validation under <profileLabel>.`. */
function emptyCompileResult(): CompileResult {
  return {
    entries: new Map(),
    links: [],
    forward: new Map(),
    reverse: new Map(),
    documents: new Map(),
    diagnostics: [],
    typeRegistry: { bindings: new Map(), typedefs: new Map() },
  };
}

/** Stub Project exposing only what the validate handler reads:
 * `profileChain`, `projectRoot`, and `getCompiled()`. */
function stubProject(profileChain: ProfileChain): Project {
  return {
    projectRoot: "/proj",
    markspecDetected: true,
    softGateMessage: "",
    config: undefined,
    profileChain,
    profile: profileChain.effective,
    delivers: profileChain.effective.delivers,
    getCompiled: () => Promise.resolve(emptyCompileResult()),
    forceRefresh: () => Promise.resolve(emptyCompileResult()),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: () => Promise.resolve(undefined),
  };
}

/** Invoke the `validate` tool through registerTools + a Server stub that
 * captures the tools/call handler, returning the rendered report text. */
async function invokeValidate(project: Project): Promise<string> {
  // deno-lint-ignore no-explicit-any
  let callHandler: ((req: any) => Promise<any>) | undefined;
  const serverStub = {
    // deno-lint-ignore no-explicit-any
    setRequestHandler(schema: unknown, handler: (req: any) => Promise<any>) {
      if (schema === CallToolRequestSchema) callHandler = handler;
    },
  } as unknown as Server;
  registerTools(serverStub, project);
  if (!callHandler) throw new Error("tools/call handler not registered");
  const res = await callHandler({
    params: { name: "validate", arguments: {} },
  });
  return res.content[0].text as string;
}

Deno.test(
  "validate tool: profile label is the leaf tier, not the bundled default root",
  async () => {
    const root = makeTier(ROOT_DEFAULT_YAML);
    const leaf = makeTier(LEAF_ACME_YAML);
    const chain = makeMultiTierChain(root, leaf);
    // Sanity-check the chain is ordered root -> leaf as the loader produces.
    assertEquals(chain.tiers[0].id, "@markspec/profile-default");
    assertEquals(chain.tiers[chain.tiers.length - 1].id, "@acme/leaf");

    const report = await invokeValidate(stubProject(chain));

    assertStringIncludes(report, "under @acme/leaf@0.1.0");
    assertEquals(report.includes("@markspec/profile-default"), false);
  },
);

Deno.test(
  "validate tool: reports corpus-load diagnostics from the compiled context",
  async () => {
    // The MCP compiled context carries corpus-load diagnostics (ADR-029,
    // merged by runCompile in project.ts) — the validate tool must render
    // them so a missing delivered corpus file is not reported as clean.
    const chain = makeMultiTierChain(makeTier(ROOT_DEFAULT_YAML));
    const project = stubProject(chain);
    const withCorpusDiag: Project = {
      ...project,
      getCompiled: () =>
        Promise.resolve({
          ...emptyCompileResult(),
          diagnostics: [{
            code: "PROFILE-DELIVERS-001",
            severity: "error",
            message:
              "delivered corpus file 'reference/platform.md' declared by " +
              "platform-arch@1.2.0 is missing from the profile package",
            location: {
              file: "/profiles/platform-arch/reference/platform.md",
              line: 1,
              column: 1,
            },
          }],
        }),
    };

    const report = await invokeValidate(withCorpusDiag);

    assertStringIncludes(report, "PROFILE-DELIVERS-001");
    assertStringIncludes(report, "platform-arch@1.2.0");
  },
);

import { VALIDATE_DESCRIPTOR } from "./validate.ts";

Deno.test("VALIDATE_DESCRIPTOR.description: has TRIGGER/PREFER/SKIP blocks", () => {
  const desc = VALIDATE_DESCRIPTOR.description;
  assertStringIncludes(desc, "TRIGGER when:");
  assertStringIncludes(desc, "PREFER over:");
  assertStringIncludes(desc, "SKIP when:");
});

Deno.test("VALIDATE_DESCRIPTOR.description: names validation intent phrases", () => {
  const desc = VALIDATE_DESCRIPTOR.description;
  assertStringIncludes(desc, "broken refs");
  assertStringIncludes(desc, "duplicate IDs");
});

Deno.test("VALIDATE_DESCRIPTOR.description: keys on canonical soft-gate phrase", () => {
  assertStringIncludes(
    VALIDATE_DESCRIPTOR.description,
    "No MarkSpec project found",
  );
});

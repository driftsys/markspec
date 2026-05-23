/**
 * @module mcp/tools/validate_test
 *
 * Unit tests for the validate tool's Markdown report.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
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
  { ignore: Deno.build.os === "windows" },
  () => {
    const md = renderDiagnosticsReport([ERR, WARN], null, 1, "/proj");
    assertStringIncludes(md, "docs/req.md:128:3");
    assertStringIncludes(md.split("\n").join(" "), " docs/req.md:128:3");
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

Deno.test("filterDiagnostics: keeps matching relative path", {
  ignore: Deno.build.os === "windows",
}, () => {
  const out = filterDiagnostics([ERR, WARN], ["docs/req.md"], "/proj");
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
  };
}

/** Stub Project exposing only what the validate handler reads:
 * `profileChain`, `projectRoot`, and `getCompiled()`. */
function stubProject(profileChain: ProfileChain): Project {
  return {
    projectRoot: "/proj",
    config: undefined,
    profileChain,
    profile: profileChain.effective,
    getCompiled: () => Promise.resolve(emptyCompileResult()),
    forceRefresh: () => Promise.resolve(emptyCompileResult()),
    subscribeInvalidation: () => () => {},
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

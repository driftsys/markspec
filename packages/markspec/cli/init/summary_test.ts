import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderJsonSummary, renderTextSummary } from "./summary.ts";
import type { InitResult } from "./types.ts";

const ok: InitResult = {
  ok: true,
  exitCode: 0,
  target: "/repo",
  profile: { kind: "bundled" },
  clientsWritten: ["claude-code"],
  actions: [
    { kind: "create", file: "project.yaml" },
    { kind: "skip", file: ".markspec.yaml", reason: "exists" },
  ],
  warnings: [],
  skills: { installed: true, attempted: true },
};

Deno.test("renderJsonSummary: ok shape", () => {
  const parsed = JSON.parse(renderJsonSummary(ok));
  assertEquals(parsed.ok, true);
  assertEquals(parsed.exitCode, 0);
  assertEquals(parsed.clientsWritten, ["claude-code"]);
  assertEquals(parsed.actions.length, 2);
});

Deno.test("renderJsonSummary: error shape includes error code", () => {
  const err: InitResult = {
    ...ok,
    ok: false,
    exitCode: 1,
    error: {
      code: "TARGET_NOT_EMPTY",
      message: "target dir not empty",
      details: { unexpectedEntries: ["src/"] },
    },
  };
  const parsed = JSON.parse(renderJsonSummary(err));
  assertEquals(parsed.error.code, "TARGET_NOT_EMPTY");
  assertEquals(parsed.error.details.unexpectedEntries, ["src/"]);
});

Deno.test("renderTextSummary: human-readable layout", () => {
  const text = renderTextSummary(ok);
  assertStringIncludes(text, "project.yaml");
  assertStringIncludes(text, "create");
  assertStringIncludes(text, ".markspec.yaml");
  assertStringIncludes(text, "skip");
});

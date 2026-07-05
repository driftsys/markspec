/**
 * @module core/lock/pin_assurance_test
 */

import { assertEquals } from "@std/assert";
import { dependencyPinAssurance } from "./pin_assurance.ts";
import type { Lockfile, UpstreamDependency } from "./model.ts";

function dep(resolved: string): UpstreamDependency {
  return {
    kind: "dependency",
    id: "icd",
    url: "https://example.test/icd.git",
    intent: "main",
    resolved,
    sha: "abcdef0123456789abcdef0123456789abcdef01",
    snapshot: "sha",
    lockedAt: "2026-07-04T00:00:00Z",
  };
}
function lf(...ups: UpstreamDependency[]): Lockfile {
  return {
    schema: 1,
    meta: { markspecSchema: 1, lockedAt: "2026-07-04T00:00:00Z" },
    upstreams: ups,
    boundEntries: [],
    edges: [],
    generatedCache: { edgesHash: "", edgesCount: 0 },
  };
}

Deno.test("tag pin → no advisory", () => {
  assertEquals(dependencyPinAssurance(lf(dep("tag:v1.0.0"))), []);
});

Deno.test("branch pin → one MSL-L215 warning", () => {
  const d = dependencyPinAssurance(lf(dep("branch:main")));
  assertEquals(d.length, 1);
  assertEquals(d[0].code, "MSL-L215");
  assertEquals(d[0].severity, "warning");
});

Deno.test("sha pin → one MSL-L215 warning", () => {
  assertEquals(dependencyPinAssurance(lf(dep("sha:abcdef0"))).length, 1);
});

Deno.test("undefined lockfile → no advisory", () => {
  assertEquals(dependencyPinAssurance(undefined), []);
});

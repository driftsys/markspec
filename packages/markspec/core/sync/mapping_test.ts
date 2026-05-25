// packages/markspec/core/sync/mapping_test.ts
import { assertEquals } from "@std/assert";
import { parseMapping, validateMappings } from "./mapping.ts";

const VALID_JIRA = `
schema: 1
system: jira
direction: bidirectional
identity:
  external-id-scheme: jira
attributes:
  - markspec: Title
    external: summary
    direction: bidirectional
conflict:
  default: manual
cache:
  ttl: 15m
`;

Deno.test("parseMapping: valid yaml loads", () => {
  const r = parseMapping(VALID_JIRA, "jira.yaml");
  assertEquals(r.diagnostics.length, 0);
  assertEquals(r.mapping?.system, "jira");
  assertEquals(r.mapping?.cache.ttlMs, 15 * 60 * 1000);
});

Deno.test("parseMapping: newest-wins → MSL-S003", () => {
  const r = parseMapping(
    VALID_JIRA.replace("manual", "newest-wins"),
    "jira.yaml",
  );
  assertEquals(r.mapping, undefined);
  assertEquals(r.diagnostics[0].code, "MSL-S003");
});

Deno.test("parseMapping: locked + outbound → MSL-S002", () => {
  const yaml = `
schema: 1
system: jira
direction: outbound
identity:
  external-id-scheme: jira
attributes:
  - markspec: Title
    external: summary
    direction: outbound
    locked: true
conflict:
  default: manual
cache:
  ttl: 15m
`;
  const r = parseMapping(yaml, "jira.yaml");
  assertEquals(r.diagnostics[0].code, "MSL-S002");
});

Deno.test("parseMapping: system != external-id-scheme → MSL-S004", () => {
  const r = parseMapping(
    VALID_JIRA.replace("external-id-scheme: jira", "external-id-scheme: foo"),
    "jira.yaml",
  );
  assertEquals(r.diagnostics[0].code, "MSL-S004");
});

Deno.test("parseMapping: bad ttl → MSL-S005", () => {
  const r = parseMapping(
    VALID_JIRA.replace("15m", "not-a-duration"),
    "jira.yaml",
  );
  assertEquals(r.diagnostics[0].code, "MSL-S005");
});

Deno.test("validateMappings: two systems writing locally to same attr → MSL-S020", () => {
  const a = parseMapping(VALID_JIRA, "jira.yaml").mapping!;
  const b = parseMapping(VALID_JIRA.replace(/jira/g, "doors"), "doors.yaml")
    .mapping!;
  const diags = validateMappings([a, b]);
  assertEquals(diags.some((d) => d.code === "MSL-S020"), true);
});

Deno.test("validateMappings: outbound + bidirectional is allowed (one local writer)", () => {
  const a = parseMapping(VALID_JIRA, "jira.yaml").mapping!; // bidirectional
  // System B is fully outbound (top-level + per-attribute), so it doesn't
  // write locally — only A's bidirectional attribute writes locally, so
  // there is no multi-writer conflict on `Title`.
  const bYaml = VALID_JIRA
    .replace(/jira/g, "doors")
    .replace(/direction: bidirectional/g, "direction: outbound");
  const b = parseMapping(bYaml, "doors.yaml").mapping!;
  const diags = validateMappings([a, b]);
  assertEquals(diags.filter((d) => d.code === "MSL-S020").length, 0);
});

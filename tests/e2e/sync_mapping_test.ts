/**
 * @module tests/e2e/sync_mapping_test
 *
 * E2E tests for sync mapping validation: MSL-S003 (unknown conflict policy)
 * and MSL-S020 (multi-system local-write conflict on the same attribute).
 *
 * Both tests exercise the `markspec lock` CLI surface only — no imports from
 * source modules. Interaction is exclusively through the CLI test helpers.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecPersist } from "./helpers.ts";

const VALID_JIRA = `
schema: 1
system: jira
direction: bidirectional
identity:
  external-id-scheme: jira
attributes:
  - markspec: Title
    external: summary
cache:
  ttl: 15m
`;

Deno.test(
  "sync mapping: newest-wins conflict policy → MSL-S003 + exit 1",
  async () => {
    // The mapping parser rejects `newest-wins` (removed pre-1.0) with
    // MSL-S003. The invalid mapping stops lock before it writes a lockfile.
    const broken = VALID_JIRA + "\nconflict:\n  default: newest-wins\n";
    const run = await markspecPersist(["lock"], {
      "project.yaml": "name: t\nversion: '0.0.0'\n",
      ".markspec/sync/jira.yaml": broken,
      "reqs.md": "x\n",
    });
    try {
      assertStringIncludes(run.stderr, "MSL-S003");
      assertEquals(run.code, 1, run.stderr);
      await assertRejects(
        () => Deno.stat(join(run.dir, "markspec.lock")),
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);

Deno.test(
  "sync mapping: multi-system local-write conflict → MSL-S020 + exit 1",
  async () => {
    // Both jira.yaml and doors.yaml declare `direction: bidirectional` on
    // the same `Title` attribute, so both systems write locally.
    // `validateMappings` detects the conflict and emits MSL-S020.
    // `markspec lock` exits 1 because of the mapping-level error.
    const jira = VALID_JIRA;
    const doors = VALID_JIRA.replace(/jira/g, "doors");
    const { code, stderr } = await markspec(["lock"], {
      "project.yaml": "name: t\nversion: '0.0.0'\n",
      ".markspec/sync/jira.yaml": jira,
      ".markspec/sync/doors.yaml": doors,
      "reqs.md": "x\n",
    });
    assertStringIncludes(stderr, "MSL-S020");
    // Exit 1: the cross-system conflict is a hard error.
    if (code !== 1) {
      throw new Error(
        `expected exit code 1 for MSL-S020, got ${code}. stderr:\n${stderr}`,
      );
    }
  },
);

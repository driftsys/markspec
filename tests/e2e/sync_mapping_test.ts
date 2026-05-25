/**
 * @module tests/e2e/sync_mapping_test
 *
 * E2E tests for sync mapping validation: MSL-S003 (unknown conflict policy)
 * and MSL-S020 (multi-system local-write conflict on the same attribute).
 *
 * Both tests exercise the `markspec lock` CLI surface only — no imports from
 * source modules. Interaction is exclusively through the `markspec()` helper.
 */

import { assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

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
  "sync mapping: newest-wins conflict policy → MSL-S003 in stderr",
  async () => {
    // The mapping parser rejects `newest-wins` (removed pre-1.0) with
    // MSL-S003. The broken mapping is skipped; lock logs the diagnostic
    // to stderr and continues with the remaining (empty) mapping set.
    const broken = VALID_JIRA + "\nconflict:\n  default: newest-wins\n";
    const { stderr } = await markspec(["lock"], {
      "project.yaml": "name: t\nversion: '0.0.0'\n",
      ".markspec/sync/jira.yaml": broken,
      "reqs.md": "x\n",
    });
    assertStringIncludes(stderr, "MSL-S003");
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

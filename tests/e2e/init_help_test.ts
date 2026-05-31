import { assertSnapshot } from "@std/testing/snapshot";
import { markspec } from "./helpers.ts";

Deno.test("init --help snapshot", async (t) => {
  const { stdout } = await markspec(["init", "--help"]);
  // Mask the volatile version string so a routine version bump does not
  // break this snapshot. The Version line's presence and format are still
  // asserted — only the semver + core-schema number are normalized. (This
  // snapshot was version-chased three times — #564, 9166600, 2266df6 —
  // before being de-brittled.)
  const normalized = stdout.replace(
    /\d+\.\d+\.\d+\S* \(core-schema \d+\)/,
    "<version> (core-schema <n>)",
  );
  await assertSnapshot(t, normalized);
});

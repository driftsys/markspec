import { assertSnapshot } from "@std/testing/snapshot";
import { markspec } from "./helpers.ts";

Deno.test("init --help snapshot", async (t) => {
  const { stdout } = await markspec(["init", "--help"]);
  // Mask the volatile version string so a routine version bump does not
  // break this snapshot. The Version line's presence and format are still
  // asserted — only the semver + core-schema number are normalized. (This
  // snapshot was version-chased three times — #564, 9166600, 2266df6 —
  // before being de-brittled.)
  const masked = stdout.replace(
    /\d+\.\d+\.\d+\S* \(core-schema \d+\)/,
    "<version> (core-schema <n>)",
  );
  // Cliffy right-pads the Version row to align help columns based on the
  // *unmasked* string's width, so the masked row's trailing whitespace
  // count still shifts whenever the real version string's length changes
  // (e.g. "0.9.0" -> "0.10.0"). Strip trailing whitespace per line — it's
  // a rendering artifact, not asserted content — so the snapshot survives
  // any future version-length change instead of only this one.
  const normalized = masked.split("\n").map((line) =>
    line.replace(/[ \t]+$/, "")
  ).join("\n");
  await assertSnapshot(t, normalized);
});

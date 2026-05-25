/**
 * @module cli/commands/create
 *
 * `markspec create` — scaffold a new entry block for a profile-declared
 * type and print it to stdout.
 */

import { Command } from "@cliffy/command";
import { compileProject } from "../helpers.ts";
import type { EffectiveProfile } from "../../core/mod.ts";
import { extendsTransitively } from "../../core/profile/discipline_mode.ts";
import { nextDisplayId, resolveTypePattern } from "./id_helpers.ts";

export const createCmd = new Command()
  .description("Scaffold a new entry block for a profile-declared type")
  .arguments("<type:string> <paths...:string>")
  .action(async (_options, typeName: string, ...paths: string[]) => {
    const { result, chain } = await compileProject(paths);
    if (!chain) {
      console.error(`error: create requires a profile; none configured`);
      Deno.exit(1);
    }

    // ADR-017 Slice 5: emit a one-line mode hint when the requested
    // type isn't recommended for the active profile's discipline mode.
    // The scaffold still prints to stdout regardless. The hint runs
    // before nextDisplayId so it fires even if the pattern is malformed.
    emitModeHintIfOffMode(typeName, chain.effective);

    const pattern = resolveTypePattern(typeName, chain, "create");
    const displayId = nextDisplayId(pattern, result.entries.values());

    const { ulid } = await import("@std/ulid");
    const id = ulid();

    const block =
      `- [${displayId}] ${typeName[0].toUpperCase()}${
        typeName.slice(1)
      } title\n` +
      `\n  Body text.\n\n      Id: ${id}\n      Type: ${typeName}\n`;
    console.log(block);
  });

/**
 * ADR-017 Slice 5: emit a one-line stderr hint when `typeName` is not
 * the recommended scaffold for the active profile's discipline mode.
 * No-op when the type is recommended or absent from the profile (the
 * absent-type case is handled later by `resolveTypePattern`).
 *
 * The recommendation rule mirrors the LSP scaffold completion (Task 7):
 *   - tiered: type has `discipline:` set
 *   - flat:   type is requirement-shaped AND lacks `discipline:`
 *   - none:   type is requirement-shaped (any)
 */
function emitModeHintIfOffMode(
  typeName: string,
  effective: EffectiveProfile,
): void {
  const mode = effective.disciplineMode.value;
  const td = effective.types.get(typeName);
  if (!td) return;
  const hasDiscipline = td.value.discipline.value !== undefined;
  const isRequirementShaped = extendsTransitively(
    typeName,
    "Requirement",
    effective,
  );
  const isRecommended = (mode === "tiered" && hasDiscipline) ||
    (mode === "flat" && isRequirementShaped && !hasDiscipline) ||
    (mode === "none" && isRequirementShaped);
  if (isRecommended) return;

  // Build the "consider …" clause from every other recommended type
  // declared by the profile. O(N²) overall but profile.types.size is
  // small (<20 in practice) so trivially fast.
  const recommended: string[] = [];
  for (const [otherName, otherTd] of effective.types) {
    const otherHasDisc = otherTd.value.discipline.value !== undefined;
    const otherIsReq = extendsTransitively(
      otherName,
      "Requirement",
      effective,
    );
    const otherIsRec = (mode === "tiered" && otherHasDisc) ||
      (mode === "flat" && otherIsReq && !otherHasDisc) ||
      (mode === "none" && otherIsReq);
    if (otherIsRec) recommended.push(otherName);
  }
  recommended.sort();
  const consider = recommended.length > 0
    ? ` (consider one of: ${recommended.join(", ")})`
    : "";
  console.error(
    `hint: '${typeName}' is not the recommended scaffold for profile mode '${mode}'${consider}`,
  );
}

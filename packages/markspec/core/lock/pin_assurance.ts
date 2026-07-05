/**
 * @module core/lock/pin_assurance
 *
 * Release-assurance advisory for federated dependencies (design §4.4). Every
 * `[[upstream.dependency]]` pin that resolved to a branch or bare sha (rather
 * than a tag) is an "unreleased" pin. Below `check --strict` this is a gentle
 * project-level advisory; `check --strict` promotes the warning to an error,
 * making it the release gate — you cannot release against a dependency that
 * never baselined. Pure.
 */

import type { Diagnostic } from "../model/mod.ts";
import type { Lockfile } from "./model.ts";

/**
 * Emit one `MSL-L215` warning per `[[upstream.dependency]]` row whose
 * `resolved` value is not a tag pin (`branch:*` or `sha:*`). Returns an
 * empty array for an all-tag lockfile or an undefined lockfile (no
 * `markspec.lock` present).
 */
export function dependencyPinAssurance(
  lockfile: Lockfile | undefined,
): Diagnostic[] {
  if (!lockfile) return [];
  const out: Diagnostic[] = [];
  for (const u of lockfile.upstreams) {
    if (u.kind !== "dependency") continue;
    if (u.resolved.startsWith("tag:")) continue;
    out.push({
      code: "MSL-L215",
      severity: "warning",
      message:
        `dependency '${u.id}' is pinned to an unreleased state (${u.resolved} @ ${
          u.sha.slice(0, 12)
        }); release builds (check --strict) require a tagged pin — ask the upstream to cut a tag, then run 'markspec lock --update=${u.id}'`,
      location: undefined,
    });
  }
  return out;
}

/**
 * @module cli/init/scaffolders/project_yaml
 *
 * Scaffolder for `project.yaml`. Pure builder (no I/O) + a thin
 * file-writing wrapper that respects the spec §4 idempotency rule
 * (skip when file exists).
 */

import { join } from "@std/path";
import type { MemFs } from "../fake_fs.ts";

const SCHEMA_URL = "https://driftsys.github.io/schemas/project/v1.json";

export interface ProjectYamlInput {
  /** Final segment of the target dir; basis for the `name` field. */
  readonly dirname: string;
}

/**
 * Produce the YAML text for a minimal project.yaml. Pure — no I/O.
 *
 * `name` is derived from `dirname` by lowercasing, taking the last
 * path segment, and replacing runs of non-`[a-z0-9-]` characters with
 * a single hyphen.
 */
export function buildProjectYaml(input: ProjectYamlInput): string {
  const safeName = sanitiseName(input.dirname);
  return [
    `$schema: ${SCHEMA_URL}`,
    `name: "${safeName}"`,
    `version: "0.1.0"`,
    `description: ""`,
    "",
  ].join("\n");
}

/**
 * Write `project.yaml` into `targetDir` via `fs` if absent. Returns
 * `true` if a write occurred.
 */
export async function scaffoldProjectYaml(
  fs: MemFs,
  targetDir: string,
  dirnameForName: string,
): Promise<boolean> {
  const path = join(targetDir, "project.yaml");
  if (await fs.exists(path)) return false;
  await fs.write(path, buildProjectYaml({ dirname: dirnameForName }));
  return true;
}

function sanitiseName(raw: string): string {
  const last = raw
    .split(/[\\/]/)
    .filter((s) => s.length > 0 && s !== "..")
    .pop() ?? "project";
  const sanitised = last
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, ""); // org name pattern requires a leading letter
  return sanitised || "project";
}

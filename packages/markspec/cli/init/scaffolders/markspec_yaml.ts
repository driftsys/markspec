/**
 * @module cli/init/scaffolders/markspec_yaml
 *
 * Scaffolder for `.markspec.yaml`. Four branches per
 * {@linkcode ProfileChoice}. The bundled-default file is non-empty so
 * slice D's MCP project soft-gate can detect it as a project marker.
 */

import { join } from "@std/path";
import type { MemFs } from "../fake_fs.ts";
import type { ProfileChoice } from "../types.ts";

export function buildMarkspecYaml(choice: ProfileChoice): string {
  switch (choice.kind) {
    case "bundled":
      return [
        "# Profile chain — bundled default active implicitly.",
        "# See https://markspec.dev/profiles/",
        "",
      ].join("\n");
    case "git":
      return ["profiles:", `  - ${choice.spec}`, ""].join("\n");
    case "local":
      return ["profiles:", `  - ${choice.spec}`, ""].join("\n");
    case "none":
      return ["default-profile: false", ""].join("\n");
  }
}

export async function scaffoldMarkspecYaml(
  fs: MemFs,
  targetDir: string,
  choice: ProfileChoice,
): Promise<boolean> {
  const path = join(targetDir, ".markspec.yaml");
  if (await fs.exists(path)) return false;
  await fs.write(path, buildMarkspecYaml(choice));
  return true;
}

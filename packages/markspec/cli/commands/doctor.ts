/**
 * @module cli/commands/doctor
 *
 * `markspec doctor` — project health check.
 */

import { Command } from "@cliffy/command";
import { loadActiveProfile, requireProjectConfig } from "../helpers.ts";

export const doctorCmd = new Command()
  .description("Project health check")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(async (options: { format?: string }) => {
    const { config, projectRoot } = await requireProjectConfig();

    // Load profile, but catch diagnostics via loadActiveProfile
    // (it already prints diagnostics and exits on error).
    const chain = await loadActiveProfile(projectRoot);

    const diagnostics: Array<
      { severity: string; code: string; message: string }
    > = [];

    const leaf = chain ? chain.tiers[chain.tiers.length - 1] : null;
    const tierCount = chain ? chain.tiers.length : 0;

    if (options.format === "json") {
      const output = {
        project: {
          name: config.name,
          version: config.version,
          root: projectRoot,
        },
        profile: leaf
          ? {
            id: leaf.id,
            version: leaf.version,
            tiers: tierCount,
          }
          : null,
        diagnostics,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.error(`Project: ${config.name} (${config.version})`);
      console.error(`Root: ${projectRoot}`);
      if (leaf) {
        console.error(
          `Profile: ${leaf.id}@${leaf.version} (${tierCount} tier(s))`,
        );
      } else {
        console.error("Profile: no profile configured");
      }
    }
  });

/**
 * @module cli/commands/self_upgrade
 *
 * `markspec self-upgrade` — fetch the latest release for the current
 * platform, verify its SHA-256, and atomically replace the running
 * binary.
 *
 * Flags:
 *   --check              Check only; exit 1 if a newer release is available.
 *   --version <vX.Y.Z>   Pin a specific release (downgrade allowed).
 *   --format <text|json> Output format (default: text).
 *   --quiet              Suppress non-error stdout (inherited).
 *
 * Environment overrides (test seams + advanced users):
 *   MARKSPEC_RELEASES_API
 *     Base URL for the releases API endpoint. Default:
 *     "https://api.github.com/repos/driftsys/markspec/releases".
 *   MARKSPEC_RELEASES_DOWNLOAD_BASE
 *     Base URL for tarball downloads. Default:
 *     "https://github.com/driftsys/markspec/releases/download".
 *   MARKSPEC_SELF_UPGRADE_BIN_PATH
 *     Override the binary path that will be swapped. Test-only; lets
 *     E2E tests point at a temp file instead of Deno.execPath().
 */

import { Command } from "@cliffy/command";
import { basename, dirname } from "@std/path";
import {
  classifyInstallPath,
  compareVersions,
  detectTarget,
  platformFromBuild,
  releaseAssets,
  VERSION,
} from "../../core/mod.ts";
import { extractSingleBinary } from "../self_upgrade/extract.ts";
import {
  downloadTo,
  fetchChecksum,
  fetchLatestTag,
  sha256OfFile,
} from "../self_upgrade/http.ts";
import {
  type Outcome,
  pmHint,
  type Reason,
  renderJson,
  renderText,
} from "../self_upgrade/report.ts";
import {
  cleanupStaleOld,
  isDirWritable,
  swapBinary,
} from "../self_upgrade/swap.ts";

const DEFAULT_API = "https://api.github.com/repos/driftsys/markspec/releases";
const DEFAULT_DOWNLOAD_BASE =
  "https://github.com/driftsys/markspec/releases/download";

interface SelfUpgradeOptions {
  check?: boolean;
  version?: string;
  format?: string;
  quiet?: boolean;
}

export const selfUpgradeCmd = new Command()
  .description("Download and atomically replace the running markspec binary")
  .option("--check", "Check only; exit 1 if a newer release is available")
  .option(
    "--version <version:string>",
    "Pin a specific release (downgrade allowed)",
  )
  .option("--format <format:string>", "Output format: text|json", {
    default: "text",
  })
  .action(async (options) => {
    const out = await runSelfUpgrade(options as SelfUpgradeOptions);
    emit(out, (options as SelfUpgradeOptions).format ?? "text");
    Deno.exit(exitCodeFor(out));
  });

async function runSelfUpgrade(
  opts: SelfUpgradeOptions,
): Promise<Outcome> {
  const apiBase = Deno.env.get("MARKSPEC_RELEASES_API") ?? DEFAULT_API;
  const downloadBase = Deno.env.get("MARKSPEC_RELEASES_DOWNLOAD_BASE") ??
    DEFAULT_DOWNLOAD_BASE;
  const binPathOverride = Deno.env.get("MARKSPEC_SELF_UPGRADE_BIN_PATH");

  const platform = platformFromBuild(Deno.build.os, Deno.build.arch);
  if (!platform) {
    return error(
      "platform",
      VERSION,
      null,
      "",
      `unsupported platform: ${Deno.build.os}/${Deno.build.arch}. Supported: linux-x64, darwin-x64, darwin-arm64, windows-x64.`,
    );
  }
  const target = detectTarget(platform);
  if (!target) {
    return error(
      "platform",
      VERSION,
      null,
      "",
      `no release target for ${platform.os}/${platform.arch}`,
    );
  }

  // Resolve the binary's real path. Override available for tests.
  let realExecPath: string;
  try {
    realExecPath = binPathOverride
      ? await Deno.realPath(binPathOverride)
      : await Deno.realPath(Deno.execPath());
  } catch (err) {
    return error(
      "not-a-markspec-binary",
      VERSION,
      null,
      "",
      `cannot resolve binary path: ${(err as Error).message}`,
    );
  }

  // Refuse if not a markspec binary (e.g. running under `deno run`).
  const base = basename(realExecPath).toLowerCase();
  if (!base.startsWith("markspec")) {
    return error(
      "not-a-markspec-binary",
      VERSION,
      null,
      realExecPath,
      `this command only works on a compiled markspec binary; running under ${base} instead`,
    );
  }

  // Determine target version.
  let targetVersion: string;
  if (opts.version) {
    targetVersion = opts.version;
  } else {
    try {
      targetVersion = await fetchLatestTag(apiBase);
    } catch (err) {
      return error(
        "network",
        VERSION,
        null,
        realExecPath,
        (err as Error).message,
      );
    }
  }

  // Compare.
  let cmp: ReturnType<typeof compareVersions>;
  try {
    cmp = compareVersions(VERSION, targetVersion);
  } catch (err) {
    return error(
      "version-not-found",
      VERSION,
      targetVersion,
      realExecPath,
      (err as Error).message,
    );
  }

  // --check: exit without changes.
  if (opts.check) {
    if (cmp === "newer-available") {
      return {
        action: "checked",
        current: VERSION,
        target: stripV(targetVersion),
        binaryPath: realExecPath,
        message: `markspec ${VERSION} — latest is ${
          stripV(targetVersion)
        }. Run \`markspec self-upgrade\` to update.`,
      };
    }
    if (cmp === "downgrade") {
      return {
        action: "checked",
        current: VERSION,
        target: stripV(targetVersion),
        binaryPath: realExecPath,
        message: `markspec ${VERSION} is ahead of ${
          stripV(targetVersion)
        } (no upgrade available).`,
      };
    }
    return {
      action: "checked",
      current: VERSION,
      target: stripV(targetVersion),
      binaryPath: realExecPath,
      message: `markspec ${VERSION} (up-to-date).`,
    };
  }

  // Up-to-date: nothing to do.
  if (cmp === "up-to-date") {
    return {
      action: "already-current",
      current: VERSION,
      target: stripV(targetVersion),
      binaryPath: realExecPath,
      message: `markspec ${VERSION} is already on the latest release.`,
    };
  }

  // Ahead of latest (no explicit --version): refuse-but-OK.
  if (cmp === "downgrade" && !opts.version) {
    return {
      action: "already-current",
      current: VERSION,
      target: stripV(targetVersion),
      binaryPath: realExecPath,
      message: `markspec ${VERSION} is ahead of the latest release (${
        stripV(targetVersion)
      }). Pass --version v${
        stripV(targetVersion)
      } if you intentionally want to downgrade.`,
    };
  }

  // PM-managed path?
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  const classification = classifyInstallPath(realExecPath, home);
  if (
    classification.source === "homebrew" ||
    classification.source === "npm" ||
    classification.source === "system"
  ) {
    const hint = pmHint(classification.source);
    const detail = classification.source === "system"
      ? "use your system package manager"
      : `run \`${hint}\` instead`;
    return refused(
      classification.source as Reason,
      realExecPath,
      `this markspec was installed via ${
        humanSourceLabel(classification.source)
      } (path: ${realExecPath}). ${detail}.`,
    );
  }

  // Writable dir?
  const dir = dirname(realExecPath);
  if (!(await isDirWritable(dir))) {
    return refused(
      "unwritable",
      realExecPath,
      `install directory ${dir} is not writable. Run with sufficient privileges or reinstall to a writable location.`,
    );
  }

  // Best-effort cleanup of a leftover .old from a previous run.
  await cleanupStaleOld(realExecPath);

  // Download + verify + extract + swap.
  const { tarballUrl, checksumUrl } = releaseAssets(
    downloadBase,
    targetVersion,
    target,
  );
  const entryName = platform.os === "windows" ? "markspec.exe" : "markspec";
  const tmpTar = `${dir}/.markspec-upgrade.${Deno.pid}.tar.gz`;
  const tmpBin = `${dir}/.markspec-upgrade.${Deno.pid}.bin`;
  try {
    try {
      await downloadTo(tarballUrl, tmpTar);
    } catch (err) {
      return error(
        "network",
        VERSION,
        stripV(targetVersion),
        realExecPath,
        (err as Error).message,
      );
    }
    let expected: string;
    try {
      expected = await fetchChecksum(checksumUrl);
    } catch (err) {
      return error(
        "network",
        VERSION,
        stripV(targetVersion),
        realExecPath,
        (err as Error).message,
      );
    }
    const actual = await sha256OfFile(tmpTar);
    if (expected !== actual) {
      return error(
        "checksum",
        VERSION,
        stripV(targetVersion),
        realExecPath,
        `checksum mismatch — download may be corrupt. Retry.`,
      );
    }
    try {
      await extractSingleBinary(tmpTar, tmpBin, entryName);
    } catch (err) {
      return error(
        "checksum",
        VERSION,
        stripV(targetVersion),
        realExecPath,
        (err as Error).message,
      );
    }

    // Make the new binary executable on POSIX.
    if (platform.os !== "windows") {
      await Deno.chmod(tmpBin, 0o755);
    }

    await swapBinary(realExecPath, tmpBin);
  } finally {
    await Deno.remove(tmpTar).catch(() => {});
    await Deno.remove(tmpBin).catch(() => {});
  }

  const verbed = cmp === "downgrade" ? "Switched" : "Upgraded";
  return {
    action: "upgraded",
    current: VERSION,
    target: stripV(targetVersion),
    binaryPath: realExecPath,
    message: `${verbed} markspec ${VERSION} → ${
      stripV(targetVersion)
    } (binary at ${realExecPath}). Restart any running markspec processes to pick up the new version.`,
  };
}

function emit(out: Outcome, format: string): void {
  if (format === "json") {
    const isError = out.action === "error" || out.action === "refused";
    const stream = isError ? Deno.stderr : Deno.stdout;
    const enc = new TextEncoder();
    stream.writeSync(enc.encode(renderJson(out) + "\n"));
    return;
  }
  const rendered = renderText(out);
  const enc = new TextEncoder();
  if (rendered.stdout) Deno.stdout.writeSync(enc.encode(rendered.stdout));
  if (rendered.stderr) Deno.stderr.writeSync(enc.encode(rendered.stderr));
}

function exitCodeFor(out: Outcome): number {
  if (out.action === "refused" || out.action === "error") return 2;
  if (out.action === "checked" && out.target && out.current !== out.target) {
    // --check returns 1 when a newer release is available (only).
    try {
      if (compareVersions(out.current, out.target) === "newer-available") {
        return 1;
      }
    } catch {
      /* fall through to 0 */
    }
  }
  return 0;
}

function stripV(v: string): string {
  return v.startsWith("v") ? v.slice(1) : v;
}

function humanSourceLabel(s: "homebrew" | "npm" | "system"): string {
  if (s === "homebrew") return "Homebrew";
  if (s === "npm") return "npm";
  return "a system package";
}

function error(
  reason: Reason,
  current: string,
  target: string | null,
  binaryPath: string,
  message: string,
): Outcome {
  return { action: "error", current, target, binaryPath, reason, message };
}

function refused(
  reason: Reason,
  binaryPath: string,
  message: string,
): Outcome {
  return {
    action: "refused",
    current: VERSION,
    target: null,
    binaryPath,
    reason,
    message,
  };
}

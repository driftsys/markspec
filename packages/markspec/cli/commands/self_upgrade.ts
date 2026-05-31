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
 *
 * Environment overrides — all test-only, gated behind MARKSPEC_TEST_MODE=1
 * so a stray or hostile env var in a user's parent shell cannot redirect a
 * production self-upgrade to an attacker-controlled origin or path (#580):
 *   MARKSPEC_RELEASES_API
 *     Base URL for the releases API endpoint. Ignored unless
 *     MARKSPEC_TEST_MODE=1; production always uses the pinned default
 *     "https://api.github.com/repos/driftsys/markspec/releases".
 *   MARKSPEC_RELEASES_DOWNLOAD_BASE
 *     Base URL for tarball downloads. Ignored unless MARKSPEC_TEST_MODE=1;
 *     production always uses the pinned default
 *     "https://github.com/driftsys/markspec/releases/download".
 *   MARKSPEC_SELF_UPGRADE_BIN_PATH
 *     Override the binary path that will be swapped. Ignored unless
 *     MARKSPEC_TEST_MODE=1.
 *
 * As defence-in-depth, every resolved endpoint is run through
 * assertTrustedReleaseUrl before any fetch: production permits only https
 * to the github.com hosts; loopback http is allowed solely under test mode.
 */

import { Command } from "@cliffy/command";
import { basename, dirname } from "@std/path";
import {
  assertTrustedReleaseUrl,
  classifyInstallPath,
  compareVersions,
  detectTarget,
  platformFromBuild,
  releaseAssets,
  resolveReleaseEndpoints,
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
    const o = options as SelfUpgradeOptions;
    const format = o.format ?? "text";
    if (format !== "text" && format !== "json") {
      Deno.stderr.writeSync(
        new TextEncoder().encode(
          `error: invalid --format '${format}'; expected 'text' or 'json'\n`,
        ),
      );
      Deno.exit(2);
    }
    const out = await runSelfUpgrade(o);
    emit(out, format);
    Deno.exit(exitCodeFor(out));
  });

async function runSelfUpgrade(
  opts: SelfUpgradeOptions,
): Promise<Outcome> {
  // Every override (release URLs + bin path) is gated on MARKSPEC_TEST_MODE=1
  // (see module docstring); a stray or hostile env var in a user's parent
  // shell cannot redirect a production self-upgrade. In production the pinned
  // github.com endpoints are always used (#580).
  const testMode = Deno.env.get("MARKSPEC_TEST_MODE") === "1";
  const { apiBase, downloadBase } = resolveReleaseEndpoints({
    testMode,
    apiOverride: Deno.env.get("MARKSPEC_RELEASES_API"),
    downloadOverride: Deno.env.get("MARKSPEC_RELEASES_DOWNLOAD_BASE"),
  });
  // Defence-in-depth: refuse to fetch from an insecure or non-github origin
  // even if a future change loosens the gating above. Loopback http is
  // permitted only under test mode.
  try {
    assertTrustedReleaseUrl(apiBase, { allowInsecure: testMode });
    assertTrustedReleaseUrl(downloadBase, { allowInsecure: testMode });
  } catch (err) {
    return error("network", VERSION, null, "", (err as Error).message);
  }
  const binPathOverride = testMode
    ? Deno.env.get("MARKSPEC_SELF_UPGRADE_BIN_PATH")
    : undefined;

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
  // A 404 on the tarball or checksum URL while the user pinned an
  // explicit --version is almost always a missing-tag error, not a
  // transport problem. Reclassify so the JSON `reason` is accurate.
  const reclassifyAs404 = (msg: string): "version-not-found" | "network" =>
    opts.version && msg.includes("status 404")
      ? "version-not-found"
      : "network";
  try {
    try {
      await downloadTo(tarballUrl, tmpTar);
    } catch (err) {
      const msg = (err as Error).message;
      return error(
        reclassifyAs404(msg),
        VERSION,
        stripV(targetVersion),
        realExecPath,
        msg,
      );
    }
    let expected: string;
    try {
      expected = await fetchChecksum(checksumUrl);
    } catch (err) {
      const msg = (err as Error).message;
      return error(
        reclassifyAs404(msg),
        VERSION,
        stripV(targetVersion),
        realExecPath,
        msg,
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

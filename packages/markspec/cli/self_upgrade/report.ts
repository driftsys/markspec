/**
 * @module cli/self_upgrade/report
 *
 * Text + JSON output formatters for `markspec self-upgrade`. Pure
 * functions of an Outcome → strings; the orchestrator writes them to
 * stdout/stderr. Keeping this module pure makes the message wording
 * unit-testable alongside the orchestrator.
 */

import type { InstallSource } from "../../core/self_upgrade/mod.ts";

export type Action =
  | "upgraded"
  | "already-current"
  | "checked"
  | "refused"
  | "error";

export type Reason =
  | "homebrew"
  | "npm"
  | "system"
  | "unwritable"
  | "network"
  | "checksum"
  | "platform"
  | "version-not-found"
  | "not-a-markspec-binary";

export interface Outcome {
  readonly action: Action;
  readonly current: string;
  readonly target: string | null;
  readonly binaryPath: string;
  readonly reason?: Reason;
  readonly message: string;
}

export function renderText(out: Outcome): { stdout: string; stderr: string } {
  if (out.action === "error" || out.action === "refused") {
    return { stdout: "", stderr: `error: ${out.message}\n` };
  }
  return { stdout: `${out.message}\n`, stderr: "" };
}

export function renderJson(out: Outcome): string {
  return JSON.stringify({
    action: out.action,
    current: out.current,
    target: out.target,
    binaryPath: out.binaryPath,
    reason: out.reason ?? null,
    message: out.message,
  });
}

export function pmHint(source: InstallSource): string | undefined {
  if (source === "homebrew") return "brew upgrade markspec";
  if (source === "npm") return "npm update -g markspec";
  return undefined;
}

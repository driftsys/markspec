/**
 * @module cli/init/profile_picker
 *
 * Two surfaces:
 *
 *   - {@linkcode parseProfileSpec}: pure regex validator for the
 *     `--profile <spec>` flag.
 *   - {@linkcode runProfilePicker}: drives the TTY numbered menu via a
 *     {@linkcode Prompter} test seam (no direct console I/O).
 */

import type { ProfileChoice } from "./types.ts";

/** Test seam — production wires `prompt()` from `@std/cli/prompt`. */
export interface Prompter {
  question(message: string): Promise<string>;
}

const GIT_RE = /^git\+(https?|ssh):\/\/.+$/;
const LOCAL_RE = /^\.{0,2}\/.+|^\/.+$/;

export function parseProfileSpec(raw: string): ProfileChoice | undefined {
  const s = raw.trim();
  if (s === "bundled") return { kind: "bundled" };
  if (s === "false") return { kind: "none" };
  if (GIT_RE.test(s)) return { kind: "git", spec: s };
  if (LOCAL_RE.test(s)) return { kind: "local", spec: s };
  return undefined;
}

const MENU = `
Which profile chain do you want?

  [1] bundled default  (recommended) — built-in @markspec/profile-default
  [2] git URL          — e.g. git+https://github.com/org/aspice-profile
  [3] local path       — e.g. ../profiles/aspice
  [4] core-only        — no profile (advanced)

Choice [1]: `;

const MAX_ATTEMPTS = 3;

export async function runProfilePicker(
  prompter: Prompter,
): Promise<ProfileChoice> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = (await prompter.question(MENU)).trim();
    const choice = raw === "" ? "1" : raw;
    switch (choice) {
      case "1":
        return { kind: "bundled" };
      case "2": {
        const url = (await prompter.question("Git URL: ")).trim();
        const parsed = parseProfileSpec(url);
        if (parsed?.kind === "git") return parsed;
        break;
      }
      case "3": {
        const path =
          (await prompter.question("Local path (relative to project): "))
            .trim();
        const parsed = parseProfileSpec(path);
        if (parsed?.kind === "local") return parsed;
        break;
      }
      case "4": {
        const yn = (await prompter.question(
          "Core-only mode disables the default profile's type vocabulary. Continue? [y/N]: ",
        )).trim().toLowerCase();
        if (yn === "y" || yn === "yes") return { kind: "none" };
        break;
      }
      default:
        break;
    }
  }
  throw new Error("profile picker: max attempts exceeded");
}

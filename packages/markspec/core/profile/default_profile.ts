/**
 * @module core/profile/default_profile
 *
 * The bundled default profile (profile-schema §7 / §2.2). It ships as an
 * embedded string constant — never a file on disk — so it survives
 * `deno compile` and runs under Node without I/O. It is auto-registered as
 * the implicit root of the `extends:` chain unless `default-profile: false`
 * is set in `.markspec.yaml`.
 *
 * Scope (mechanism only): a minimal identity profile — stable id + the
 * default colour roles, no types, no rules. The profile-schema §7.1
 * display-ID pattern bindings, RFC 2119 hygiene, and `{{def.}}` glossary
 * are deferred (they need a core-type-binding schema construct).
 */

import type { ProfileSpecifier } from "../model/mod.ts";

/** Specifier that resolves to the embedded default profile. */
export const BUILTIN_DEFAULT_SPECIFIER: ProfileSpecifier = { kind: "builtin" };

/**
 * Synthetic source path used for the embedded manifest in diagnostics and
 * tier bookkeeping. Not a real filesystem path.
 */
export const BUILTIN_DEFAULT_SOURCE_PATH =
  "<bundled:@markspec/profile-default>";

/** The embedded default-profile manifest, authored as YAML. */
export const DEFAULT_PROFILE_MANIFEST = `id: "@markspec/profile-default"
version: 1.0.0
markspec-schema: "1"
description: Baseline MarkSpec profile
license: MIT
profile:
  attributes: []
  labels: []
  colors:
    primary: blue
    secondary: teal
    tertiary: cyan
    accent: purple
    muted: grey
    warning: orange
    danger: red
  types: {}
  documents:
    types: []
    frontMatter: []
`;

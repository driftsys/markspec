/**
 * @module uxil/vocab
 *
 * The two closed, core-owned uxil vocabularies (design §2/§3): three surface
 * kinds and eleven interaction verbs, each with the semantics diagnostics and
 * codegen rely on. Extension is a markspec release decision — not a profile
 * concern (ADR-009).
 */

/** Semantics carried by a surface kind. */
export interface KindInfo {
  /** A valid `navigate ->` target (only `screen`). */
  readonly navigable: boolean;
  /** May declare `@` states. */
  readonly stateful: boolean;
  /** Subject of visibility assertions / `observe` anchors. */
  readonly visual: boolean;
}

/** Semantics carried by an interaction verb. */
export interface VerbInfo {
  /** Requires a declared `-> target` (only `navigate`). */
  readonly requiresNavTarget: boolean;
  /** Exclusive on an element — interactive or anchor, never both (only `observe`). */
  readonly exclusive: boolean;
}

/** The three closed, core-owned surface kinds. */
export const UX_KINDS: ReadonlyMap<string, KindInfo> = new Map([
  ["screen", { navigable: true, stateful: true, visual: true }],
  ["panel", { navigable: false, stateful: false, visual: true }],
  ["agent", { navigable: false, stateful: true, visual: false }],
]);

/** The eleven closed, core-owned interaction verbs. */
export const UX_VERBS: ReadonlyMap<string, VerbInfo> = new Map([
  ["activate", { requiresNavTarget: false, exclusive: false }],
  ["toggle", { requiresNavTarget: false, exclusive: false }],
  ["select", { requiresNavTarget: false, exclusive: false }],
  ["adjust", { requiresNavTarget: false, exclusive: false }],
  ["input", { requiresNavTarget: false, exclusive: false }],
  ["scroll", { requiresNavTarget: false, exclusive: false }],
  ["drag", { requiresNavTarget: false, exclusive: false }],
  ["navigate", { requiresNavTarget: true, exclusive: false }],
  ["dismiss", { requiresNavTarget: false, exclusive: false }],
  ["ask", { requiresNavTarget: false, exclusive: false }],
  ["observe", { requiresNavTarget: false, exclusive: true }],
]);

/** True when `kind` is one of the three closed surface kinds. */
export function isKnownKind(kind: string): boolean {
  return UX_KINDS.has(kind);
}

/** True when `verb` is one of the eleven closed interaction verbs. */
export function isKnownVerb(verb: string): boolean {
  return UX_VERBS.has(verb);
}

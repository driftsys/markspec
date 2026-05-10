/**
 * @module mcp/resources/profile
 *
 * Renders the `markspec://profile` resource — a Markdown distillation of
 * the active profile chain. The renderer takes a typed view (see
 * {@linkcode ProfileView}) rather than the raw `EffectiveProfile` so it
 * stays decoupled from internal core types.
 *
 * The {@linkcode buildProfileView} helper produces a `ProfileView` from a
 * `ProfileChain | null`.
 */

import type {
  EffectiveProfile,
  EffectiveTypeDef,
  ProfileChain,
} from "../../core/mod.ts";

/** Per-type distillation. */
export interface ProfileTypeView {
  readonly name: string;
  readonly shape: string;
  readonly displayIdPattern: string | undefined;
  readonly color: string | undefined;
  readonly requiredAttributes: readonly string[];
  readonly allowedAttributes: readonly string[];
  readonly outgoingLinks: readonly string[];
  readonly incomingLinks: readonly string[];
  readonly description: string;
}

/** Per-tier descriptor. */
export interface ProfileTierView {
  readonly id: string;
  readonly version: string;
  readonly description: string;
}

/** Renderer input — typed view of the profile chain. */
export interface ProfileView {
  readonly tiers: readonly ProfileTierView[];
  readonly types: readonly ProfileTypeView[];
  readonly universalRequired: readonly string[];
  readonly universalAllowed: readonly string[];
  readonly linkKinds: readonly string[];
  readonly labels: readonly string[];
}

/** Build a {@linkcode ProfileView} from a {@linkcode ProfileChain}. */
export function buildProfileView(
  chain: ProfileChain | null,
): ProfileView | null {
  if (!chain) return null;
  const eff: EffectiveProfile = chain.effective;

  const tiers: ProfileTierView[] = chain.tiers.map((t) => ({
    id: t.id,
    version: t.version,
    description: t.manifest.description ?? "",
  }));

  const universalRequired = [...eff.required.value];
  const universalAllowed = [...eff.attributes.keys()];

  const types: ProfileTypeView[] = [];
  for (const [name, entry] of eff.types) {
    const tdef: EffectiveTypeDef = entry.value;
    const shape = tdef.shape;
    const shapeScope = shape === "identified" ? eff.identified : eff.referenced;

    const allowed = new Set<string>([
      ...tdef.attributes.keys(),
      ...shapeScope.attributes.keys(),
      ...eff.attributes.keys(),
    ]);
    const required = new Set<string>([
      ...tdef.required.value,
      ...shapeScope.required.value,
      ...eff.required.value,
    ]);
    for (const r of required) allowed.delete(r);

    const outgoing = new Set<string>(tdef.traceability.keys());
    // Incoming links: walk every other type's traceability and pick rules
    // whose target list contains this type's name as a string matcher.
    const incoming = new Set<string>();
    for (const [otherName, otherEntry] of eff.types) {
      if (otherName === name) continue;
      for (const [linkKind, rule] of otherEntry.value.traceability) {
        if (targetIncludesType(rule.value.target, name)) {
          incoming.add(linkKind);
        }
      }
    }

    types.push({
      name,
      shape,
      displayIdPattern: tdef.displayIdPattern.value,
      color: tdef.color.value,
      requiredAttributes: [...required],
      allowedAttributes: [...allowed],
      outgoingLinks: [...outgoing],
      incomingLinks: [...incoming],
      description: "",
    });
  }
  types.sort((a, b) => a.name.localeCompare(b.name));

  const linkKinds = new Set<string>();
  for (const [, entry] of eff.types) {
    for (const k of entry.value.traceability.keys()) linkKinds.add(k);
  }

  return {
    tiers,
    types,
    universalRequired,
    universalAllowed,
    linkKinds: [...linkKinds].sort(),
    labels: [...eff.labels.value],
  };
}

/** Render the profile view to Markdown. */
export function renderProfile(view: ProfileView | null): string {
  const lines: string[] = ["# MarkSpec Profile", ""];

  if (!view || view.tiers.length === 0) {
    lines.push("No profile configured for this project.");
    return lines.join("\n") + "\n";
  }

  const active = view.tiers[0];
  lines.push(`**Active**: ${active.id}@${active.version}`);
  if (view.tiers.length > 1) {
    const inherits = view.tiers
      .slice(1)
      .map((t) => `${t.id}@${t.version}`)
      .join(", ");
    lines.push(`**Inherits**: ${inherits}`);
  }
  if (active.description) {
    lines.push("");
    lines.push(active.description);
  }

  if (view.types.length > 0) {
    lines.push("", "## Entry types", "");
    for (const t of view.types) {
      lines.push(`### ${t.name}`, "");
      if (t.displayIdPattern) {
        lines.push(`- **Display-ID pattern**: \`${t.displayIdPattern}\``);
      }
      lines.push(`- **Shape**: ${t.shape}`);
      if (t.color) lines.push(`- **Color**: ${t.color}`);
      if (t.requiredAttributes.length > 0) {
        lines.push(
          `- **Required attributes**: ${t.requiredAttributes.join(", ")}`,
        );
      }
      if (t.allowedAttributes.length > 0) {
        lines.push(
          `- **Allowed attributes**: ${t.allowedAttributes.join(", ")}`,
        );
      }
      if (t.outgoingLinks.length > 0) {
        lines.push(`- **Outgoing links**: ${t.outgoingLinks.join(", ")}`);
      }
      if (t.incomingLinks.length > 0) {
        lines.push(`- **Incoming links**: ${t.incomingLinks.join(", ")}`);
      }
      if (t.description) {
        lines.push("", t.description);
      }
      lines.push("");
    }
  }

  if (view.universalRequired.length > 0 || view.universalAllowed.length > 0) {
    lines.push("## Universal attributes", "");
    if (view.universalRequired.length > 0) {
      lines.push(`- **Required**: ${view.universalRequired.join(", ")}`);
    }
    if (view.universalAllowed.length > 0) {
      lines.push(`- **Allowed**: ${view.universalAllowed.join(", ")}`);
    }
    lines.push("");
  }

  if (view.linkKinds.length > 0) {
    lines.push("## Link kinds", "");
    lines.push("| Kind | Used by |");
    lines.push("| --- | --- |");
    for (const kind of view.linkKinds) {
      const sources = view.types
        .filter((t) => t.outgoingLinks.includes(kind))
        .map((t) => t.name);
      lines.push(`| ${kind} | ${sources.join(", ") || "—"} |`);
    }
    lines.push("");
  }

  if (view.labels.length > 0) {
    lines.push("## Labels", "");
    lines.push(view.labels.join(", "));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Whether a {@linkcode TraceRule}'s target list contains a string matcher
 * equal to the given type name. Shape-based matchers (`{ shape: ... }`)
 * are skipped — they don't pin a single named type.
 */
function targetIncludesType(
  target: readonly (string | { readonly shape: string })[],
  typeName: string,
): boolean {
  for (const matcher of target) {
    if (typeof matcher === "string" && matcher === typeName) return true;
  }
  return false;
}

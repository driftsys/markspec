/**
 * @module mcp/resources/profile
 *
 * Renders the `markspec://profile` overview resource and individual
 * profile element detail resources. All rendering is driven by
 * {@linkcode ProfileIntrospection}; this module never re-walks
 * EffectiveProfile directly.
 */

import type {
  AttributeDetail,
  ConventionDetail,
  LabelConcernDetail,
  ProfileChain,
  ProfileElementDetail,
  ProfileIntrospection,
  RelationDetail,
  TypeDetail,
} from "../../core/mod.ts";
import { buildProfileIntrospection } from "../../core/mod.ts";
import { profileDetailUri } from "../uri.ts";

export { buildProfileIntrospection };

/** Build a {@linkcode ProfileIntrospection} from a chain (convenience wrapper). */
export function buildProfileView(
  chain: ProfileChain | null,
): ProfileIntrospection {
  return buildProfileIntrospection(chain);
}

/** Render the overview `markspec://profile` resource body as Markdown. */
export function renderProfile(intro: ProfileIntrospection): string {
  const overview = intro.overview();
  const lines: string[] = ["# MarkSpec Profile", ""];

  if (overview.tiers[0].id === "(none)") {
    lines.push("No profile configured for this project.");
    return lines.join("\n") + "\n";
  }

  const active = overview.tiers[overview.tiers.length - 1];
  lines.push(`**Active**: ${active.id}@${active.version}`);
  if (active.summary) {
    lines.push("", active.summary);
  }
  if (overview.tiers.length > 1) {
    const inherits = overview.tiers.slice(0, -1).map((t) =>
      `${t.id}@${t.version}`
    ).join(", ");
    lines.push(`**Inherits**: ${inherits}`);
  }
  lines.push("");

  // Group elements by kind and render each group.
  const kinds = [
    "type",
    "attribute",
    "relation",
    "label-concern",
    "convention",
  ] as const;
  const kindLabel: Record<string, string> = {
    "type": "Entry types",
    "attribute": "Attributes",
    "relation": "Relations",
    "label-concern": "Label concerns",
    "convention": "Conventions",
  };
  for (const kind of kinds) {
    const group = overview.elements.filter((e) => e.kind === kind);
    if (group.length === 0) continue;
    lines.push(`## ${kindLabel[kind]} (${group.length})`, "");
    for (const ref of group) {
      const detailUri = profileDetailUri(ref.kind, ref.name);
      lines.push(
        `- [${ref.kind} · **${ref.name}**](${detailUri}) — ${ref.summary}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "*Use `markspec profile describe <kind> <name>` for full details.*",
  );
  return lines.join("\n") + "\n";
}

/** Render a profile element detail as Markdown. */
export function renderProfileDetail(detail: ProfileElementDetail): string {
  switch (detail.kind) {
    case "type":
      return renderTypeDetail(detail);
    case "attribute":
      return renderAttributeDetail(detail);
    case "relation":
      return renderRelationDetail(detail);
    case "label-concern":
      return renderLabelConcernDetail(detail);
    case "convention":
      return renderConventionDetail(detail);
  }
}

function provenanceLine(
  label: string,
  text?: string,
  origin?: string,
  overrides?: readonly string[],
): string[] {
  const lines: string[] = [];
  if (text) lines.push("", text);
  if (origin) {
    const overridesStr = overrides && overrides.length > 0
      ? ` (overrides: ${overrides.join(", ")})`
      : "";
    lines.push(``, `*${label}: ${origin}${overridesStr}*`);
  }
  return lines;
}

function renderTypeDetail(detail: TypeDetail): string {
  const lines: string[] = [
    `# type · ${detail.name}`,
    "",
    `- **Extends**: ${detail.extendsTarget}`,
  ];
  if (detail.displayIdPattern) {
    lines.push(`- **Display-ID pattern**: \`${detail.displayIdPattern}\``);
  }
  if (detail.color) lines.push(`- **Color**: ${detail.color}`);
  if (detail.requiredAttributes.length > 0) {
    lines.push(
      `- **Required attributes**: ${
        detail.requiredAttributes.map((r) => r.name).join(", ")
      }`,
    );
  }
  if (detail.allowedAttributes.length > 0) {
    lines.push(
      `- **Allowed attributes**: ${
        detail.allowedAttributes.map((r) => r.name).join(", ")
      }`,
    );
  }
  if (detail.outgoingRelations.length > 0) {
    lines.push(
      `- **Outgoing relations**: ${
        detail.outgoingRelations.map((r) =>
          `[${r.name}](${profileDetailUri("relation", r.name)})`
        ).join(", ")
      }`,
    );
  }
  if (detail.incomingRelations.length > 0) {
    lines.push(
      `- **Incoming relations**: ${
        detail.incomingRelations.map((r) => r.name).join(", ")
      }`,
    );
  }
  lines.push(
    ...provenanceLine(
      "Described by",
      detail.description.text,
      detail.description.origin,
    ),
  );
  return lines.join("\n") + "\n";
}

function renderAttributeDetail(detail: AttributeDetail): string {
  const lines: string[] = [
    `# attribute · ${detail.name}`,
    "",
    `- **Type**: ${detail.valueType}, ${detail.cardinality}`,
    `- **Required**: ${detail.required}`,
  ];
  if (detail.enumValues) {
    lines.push(`- **Values**: ${detail.enumValues.join(", ")}`);
  }
  if (detail.inverse) {
    lines.push(
      `- **Inverse**: ${detail.inverse.name} (on ${detail.inverse.category})`,
    );
  }
  if (detail.declaredBy.length > 0) {
    lines.push(`- **Declared by**: ${detail.declaredBy.join(", ")}`);
  }
  lines.push(
    ...provenanceLine(
      "Described by",
      detail.description.text,
      detail.description.origin,
    ),
  );
  return lines.join("\n") + "\n";
}

function renderRelationDetail(detail: RelationDetail): string {
  const lines: string[] = [
    `# relation · ${detail.name}`,
    "",
    `- **Targets**: ${detail.targets.join(", ")}`,
    `- **Required**: ${detail.required}`,
  ];
  if (detail.cardinality) {
    lines.push(`- **Cardinality**: ${detail.cardinality}`);
  }
  if (detail.declaredBy.length > 0) {
    lines.push(`- **Declared by**: ${detail.declaredBy.join(", ")}`);
  }
  lines.push(
    ...provenanceLine(
      "Described by",
      detail.description.text,
      detail.description.origin,
    ),
  );
  return lines.join("\n") + "\n";
}

function renderLabelConcernDetail(detail: LabelConcernDetail): string {
  const lines: string[] = [
    `# label-concern · ${detail.name}`,
    "",
    `- **Kind**: ${detail.concernKind}`,
  ];
  if (detail.values.length > 0) {
    lines.push("", "**Values:**", "");
    for (const v of detail.values) {
      lines.push(
        v.description
          ? `- \`${v.name}\` — ${v.description}`
          : `- \`${v.name}\``,
      );
    }
  }
  lines.push(
    ...provenanceLine(
      "Described by",
      detail.description.text,
      detail.description.origin,
      detail.description.overrides,
    ),
  );
  return lines.join("\n") + "\n";
}

function renderConventionDetail(detail: ConventionDetail): string {
  const lines: string[] = [
    `# convention · ${detail.name}`,
    "",
  ];
  if (Object.keys(detail.settings).length > 0) {
    lines.push("**Settings:**", "");
    for (const [k, v] of Object.entries(detail.settings)) {
      lines.push(`- \`${k}\`: ${v}`);
    }
  }
  lines.push(
    ...provenanceLine(
      "Described by",
      detail.description.text,
      detail.description.origin,
    ),
  );
  return lines.join("\n") + "\n";
}

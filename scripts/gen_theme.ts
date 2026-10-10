/**
 * Generate Typst and CSS theme files from theme/tokens.yaml.
 *
 * Usage: deno run --allow-read --allow-write scripts/gen_theme.ts
 */

import { parse } from "@std/yaml";
import { dirname, fromFileUrl, join } from "@std/path";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const TOKENS_PATH = join(ROOT, "theme/tokens.yaml");
const TYPST_DIR = join(ROOT, "packages/markspec-typst");
const CSS_DIR = join(ROOT, "theme");

const HEADER_TYPST = "// Generated from theme/tokens.yaml — do not edit.\n";
const HEADER_CSS = "/* Generated from theme/tokens.yaml — do not edit. */\n";

// ── Load tokens ─────────────────────────────────────────────────────────

interface Tokens {
  fonts: Record<string, string[]>;
  scale: Record<string, { size: string; weight: string; leading: string }>;
  spacing: Record<string, string>;
  page: Record<string, string>;
  slide: Record<string, string>;
  themes: Record<string, Record<string, string>>;
  alerts: Record<
    string,
    {
      print: { border: string; bg: string };
      screen: { border: string; bg: string };
    }
  >;
  diagram: Record<string, { print: string; screen: string }>;
  app: AppTokens;
}

/** A light/dark pair — every themed app token carries one value per mode. */
interface Themed<T = string> {
  light: T;
  dark: T;
}

/** One step of the app (chrome) type scale. Sizes are px, not pt. */
interface AppTypeStep {
  size: string;
  leading: string;
  weight: number;
  tracking?: string;
  style?: string;
  /** Explicit family role (`sans` | `serif` | `mono`); see appFamily(). */
  family?: string;
}

/** The `app:` block — MarkDesk chrome, emitted as `--md-*`. */
interface AppTokens {
  scale: Record<string, AppTypeStep>;
  spacing: Record<string, string>;
  radius: Record<string, string>;
  control: Record<string, string>;
  page: Record<string, string>;
  shadow: Record<string, Themed>;
  themes: Themed<Record<string, string>>;
  status: Record<string, Themed<{ fg: string; bg: string }>>;
  code: Record<string, Themed>;
  document: { edge: Themed; family: string };
  motion: { state: string; enter: string; reduced: string };
}

const raw = await Deno.readTextFile(TOKENS_PATH);
const tokens = parse(raw) as Tokens;

// ── Helpers ─────────────────────────────────────────────────────────────

function typstFontList(fonts: string[]): string {
  return "(" + fonts.map((f) => `"${f}"`).join(", ") + ")";
}

function cssFontList(fonts: string[], generic: string): string {
  return fonts.map((f) => `"${f}"`).join(", ") + ", " + generic;
}

const FONT_GENERIC: Record<string, string> = {
  sans: "sans-serif",
  mono: "monospace",
  serif: "serif",
};

// ── Generate Typst tokens ───────────────────────────────────────────────

function genTypstTokens(): string {
  const lines: string[] = [
    HEADER_TYPST,
    "// ── Fonts ──────────────────────────────────────────────────────────────\n",
  ];

  for (const [role, fonts] of Object.entries(tokens.fonts)) {
    lines.push(`#let font-${role} = ${typstFontList(fonts)}`);
  }

  lines.push(
    "\n// ── Type scale (minor third 1.2, base 10pt) ───────────────────────────\n",
  );
  for (const [name, props] of Object.entries(tokens.scale)) {
    lines.push(`#let size-${name} = ${props.size}`);
  }
  lines.push("");
  lines.push(`#let leading-body = ${tokens.scale.body.leading}`);

  lines.push(
    "\n// ── Spacing (4pt base unit) ────────────────────────────────────────────\n",
  );
  for (const [key, val] of Object.entries(tokens.spacing)) {
    lines.push(`#let space-${key} = ${val}`);
  }

  lines.push(
    "\n// ── Page layout ────────────────────────────────────────────────────────\n",
  );
  lines.push(`#let page-margin = ${tokens.page.margin}`);
  lines.push(`#let page-size = "${tokens.page.size}"`);

  lines.push(
    "\n// ── Slide layout ───────────────────────────────────────────────────────\n",
  );
  for (const [key, val] of Object.entries(tokens.slide)) {
    lines.push(`#let slide-${key} = ${val}`);
  }

  lines.push("");
  return lines.join("\n") + "\n";
}

// ── Generate Typst theme ────────────────────────────────────────────────

function genTypstTheme(name: string, colors: Record<string, string>): string {
  const lines: string[] = [
    HEADER_TYPST,
    `// MarkSpec ${name} theme.\n`,
  ];

  for (const [key, val] of Object.entries(colors)) {
    lines.push(`#let ${key} = rgb("${val}")`);
  }

  // Entry type colors (Tol palette)
  const palette = name === "light" ? "print" : "screen";
  lines.push("\n// Entry type colors (Tol palette)");
  for (const [hue, props] of Object.entries(tokens.diagram)) {
    lines.push(`#let entry-${hue} = rgb("${props[palette]}")`);
  }

  // Alert border colors — print palette for light theme, screen for dark
  const alertPalette = name === "light" ? "print" : "screen";
  lines.push("\n// Alert border colors (Tol palette)");
  for (const [alertName, props] of Object.entries(tokens.alerts)) {
    lines.push(
      `#let alert-${alertName} = rgb("${props[alertPalette].border}")`,
    );
  }

  lines.push("");
  return lines.join("\n") + "\n";
}

// ── Generate CSS ────────────────────────────────────────────────────────

function genCss(): string {
  const lines: string[] = [
    HEADER_CSS,
    "/* ── Web fonts ──────────────────────────────────────────── */\n",
    '@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital@0;1&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400;1,600&display=swap");\n',
    ":root {",
  ];

  // Fonts
  lines.push("  /* Fonts */");
  for (const [role, fonts] of Object.entries(tokens.fonts)) {
    lines.push(
      `  --font-${role}: ${cssFontList(fonts, FONT_GENERIC[role])};`,
    );
  }

  // Scale
  lines.push("\n  /* Type scale */");
  for (const [name, props] of Object.entries(tokens.scale)) {
    lines.push(`  --size-${name}: ${props.size};`);
  }

  // Spacing
  lines.push("\n  /* Spacing */");
  for (const [key, val] of Object.entries(tokens.spacing)) {
    lines.push(`  --space-${key}: ${val};`);
  }

  // Light theme (default) — namespaced to avoid collisions with mdBook
  lines.push("\n  /* Light theme (default) */");
  for (const [key, val] of Object.entries(tokens.themes.light)) {
    lines.push(`  --ms-${key}: ${val};`);
  }

  // Entry type colors (screen/vibrant palette for HTML)
  lines.push("\n  /* Entry type colors (Tol vibrant) */");
  for (const [hue, props] of Object.entries(tokens.diagram)) {
    lines.push(`  --ms-entry-${hue}: ${props.screen};`);
  }

  // Alert colors (Tol vibrant — screen palette for HTML)
  lines.push("\n  /* Alert colors (Tol vibrant) */");
  for (const [alertName, props] of Object.entries(tokens.alerts)) {
    lines.push(`  --ms-alert-${alertName}-border: ${props.screen.border};`);
    lines.push(`  --ms-alert-${alertName}-bg: ${props.screen.bg};`);
  }

  // Diagram palette (Tol vibrant — screen palette for HTML)
  lines.push("\n  /* Diagram palette (Tol vibrant) */");
  for (const [colorName, props] of Object.entries(tokens.diagram)) {
    lines.push(`  --ms-diagram-${colorName}: ${props.screen};`);
  }

  lines.push("}\n");

  // Dark theme
  lines.push('[data-theme="dark"] {');
  for (const [key, val] of Object.entries(tokens.themes.dark)) {
    lines.push(`  --ms-${key}: ${val};`);
  }
  lines.push("}\n");

  // mdBook overrides — map mdBook vars to our namespaced tokens
  lines.push(
    "/* ── mdBook overrides ───────────────────────────────────── */\n",
  );
  lines.push(":root {");
  lines.push("  --mono-font: var(--font-mono);");
  lines.push("}\n");
  lines.push(".light, .rust {");
  lines.push("  --sidebar-bg: var(--ms-bg-code);");
  lines.push("  --sidebar-fg: var(--ms-text);");
  lines.push("  --sidebar-active: var(--ms-accent);");
  lines.push("  --links: var(--ms-accent);");
  lines.push("  --inline-code-color: var(--ms-text);");
  lines.push("  --theme-popup-bg: var(--ms-bg);");
  lines.push("  --theme-popup-border: var(--ms-border);");
  lines.push("  --quote-bg: var(--ms-bg-alert);");
  lines.push("  --quote-border: var(--ms-border);");
  lines.push("  --table-border-color: var(--ms-border);");
  lines.push("  --table-header-bg: var(--ms-bg-code);");
  lines.push("}\n");
  lines.push(".navy, .ayu, .coal {");
  lines.push("  --links: var(--ms-accent);");
  lines.push("  --inline-code-color: #e4e4e4;");
  lines.push("}\n");

  // Base typography
  lines.push(
    "/* ── Base typography ────────────────────────────────────── */\n",
  );
  lines.push("body { font-family: var(--font-sans); }");
  lines.push("code, pre > code { font-family: var(--font-mono); }");
  lines.push("h1, h2, h3, h4 { font-weight: 600; }");

  // Entry block styling
  lines.push(
    "\n/* ── Entry blocks ──────────────────────────────────────── */\n",
  );
  // Entry blocks render via the seven-hue palette — see
  // docs/superpowers/specs/2026-05-06-profile-driven-entry-colors-design.md.
  // The book HTML renderer (packages/markspec/book/site/mod.ts) emits
  // class="req-block hue-<name>" for identified entries (or `uncolored`
  // for referenced entries) using resolveEntryColor and the active
  // profile. The base .req-block rule supplies the palette-blue fallback
  // when no profile is loaded.
  lines.push(`.req-block {
  border-left: 2px solid var(--ms-entry-blue);
  padding: 0 0 0 14px;
  margin: 12pt 0;
}
.req-block.hue-cyan { border-left-color: var(--ms-entry-cyan); }
.req-block.hue-teal { border-left-color: var(--ms-entry-teal); }
.req-block.hue-orange { border-left-color: var(--ms-entry-orange); }
.req-block.hue-red { border-left-color: var(--ms-entry-red); }
.req-block.hue-purple { border-left-color: var(--ms-entry-purple); }
.req-block.hue-grey { border-left-color: var(--ms-entry-grey); }
.req-block.uncolored { border-left: none; padding-left: 0; }
.req-block .req-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.req-block .req-id { font-size: var(--size-body); font-weight: 500; color: var(--ms-entry-blue); }
.req-block.hue-cyan .req-id { color: var(--ms-entry-cyan); }
.req-block.hue-teal .req-id { color: var(--ms-entry-teal); }
.req-block.hue-orange .req-id { color: var(--ms-entry-orange); }
.req-block.hue-red .req-id { color: var(--ms-entry-red); }
.req-block.hue-purple .req-id { color: var(--ms-entry-purple); }
.req-block.hue-grey .req-id { color: var(--ms-entry-grey); }
.req-block.uncolored .req-id { color: var(--ms-text); }
.req-block .req-name { font-size: var(--size-body); font-weight: 500; }
.req-block .req-body { margin-top: 4px; line-height: 1.65; }
.req-block .req-meta { font-size: var(--size-small); font-style: italic; color: var(--ms-secondary); margin-top: 8px; }
.pill-group { display: inline-flex; gap: 4px; flex-wrap: wrap; flex-shrink: 0; }
.pill { font-size: 10px; font-weight: 500; padding: 1px 7px; border-radius: 9px; background: var(--ms-bg-code); color: var(--ms-secondary); white-space: nowrap; }
.cross-ref { text-decoration: underline dashed; text-decoration-color: var(--ms-border); text-underline-offset: 2px; color: inherit; cursor: pointer; }`);

  // Alert styling
  lines.push(
    "\n/* ── Alerts ─────────────────────────────────────────────── */\n",
  );
  lines.push(`.alert {
  border: 1px solid var(--ms-border);
  border-radius: 3px;
  padding: var(--space-2) var(--space-3);
  margin: var(--space-3) 0;
}`);
  for (const name of Object.keys(tokens.alerts)) {
    lines.push(
      `.alert.${name} { border-color: var(--ms-alert-${name}-border); background: var(--ms-alert-${name}-bg); }`,
    );
  }
  lines.push(
    `.alert-label { display: block; font-weight: 600; margin-bottom: var(--space-1); }`,
  );

  // Caption styling
  lines.push(
    "\n/* ── Captions ───────────────────────────────────────────── */\n",
  );
  lines.push(`p.caption {
  font-size: var(--size-small);
  color: var(--ms-secondary);
  font-style: italic;
  margin-top: var(--space-1);
  margin-bottom: var(--space-3);
}`);

  lines.push("");
  return lines.join("\n") + genAppCss();
}

// ── Generate app (MarkDesk) CSS ─────────────────────────────────────────
//
// The `app:` block is MarkDesk chrome. It is emitted as `--md-*` custom
// properties plus `.app-<step>` type-scale classes, appended after the
// document layer so the `--ms-*` output above stays byte-for-byte what
// the book renders with. Chrome is CSS-only: nothing here reaches Typst.

/**
 * Escape a token key for use inside a CSS custom-property name. Keys stay
 * identical to `tokens.yaml` — `space-0.5` becomes `--md-space-0\.5`
 * rather than being silently renamed.
 */
function cssIdent(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, (ch) => `\\${ch}`);
}

/**
 * Resolve the font family of an app type step. An explicit `family:`
 * wins; otherwise the step's name prefix decides: `doc-*` follows the
 * document sheet's family (`app.document.family`, so a project that
 * switches the sheet to sans moves the whole document register with it),
 * `code*` is mono, and everything else is the sans chrome register.
 */
function appFamily(name: string, step: AppTypeStep): string {
  if (step.family) return `var(--font-${step.family})`;
  if (name.startsWith("doc-")) return "var(--md-document-family)";
  if (name.startsWith("code")) return "var(--font-mono)";
  return "var(--font-sans)";
}

/** The `--md-*` declarations that differ between light and dark. */
function appThemedVars(mode: "light" | "dark"): string[] {
  const app = tokens.app;
  const lines: string[] = [];
  lines.push(`  /* App chrome (${mode}) */`);
  for (const [key, val] of Object.entries(app.themes[mode])) {
    lines.push(`  --md-${cssIdent(key)}: ${val};`);
  }
  lines.push(`\n  /* App status (${mode}) */`);
  for (const [name, pair] of Object.entries(app.status)) {
    lines.push(`  --md-status-${name}-fg: ${pair[mode].fg};`);
    lines.push(`  --md-status-${name}-bg: ${pair[mode].bg};`);
  }
  lines.push(`\n  /* App source syntax (${mode}) */`);
  for (const [name, pair] of Object.entries(app.code)) {
    lines.push(`  --md-code-${cssIdent(name)}: ${pair[mode]};`);
  }
  lines.push(`\n  /* App shadows (${mode}) */`);
  for (const [key, pair] of Object.entries(app.shadow)) {
    lines.push(`  --md-${cssIdent(key)}: ${pair[mode]};`);
  }
  lines.push(`\n  /* App document sheet (${mode}) */`);
  lines.push(`  --md-document-edge: ${app.document.edge[mode]};`);
  return lines;
}

function genAppCss(): string {
  const app = tokens.app;
  const lines: string[] = [
    "\n/* ── Application layer (MarkDesk) ───────────────────────── */\n",
    ":root {",
    "  /* App type scale (px) */",
  ];
  for (const [name, step] of Object.entries(app.scale)) {
    const id = cssIdent(name);
    lines.push(`  --md-type-${id}-size: ${step.size};`);
    lines.push(`  --md-type-${id}-leading: ${step.leading};`);
    lines.push(`  --md-type-${id}-weight: ${step.weight};`);
    if (step.tracking) {
      lines.push(`  --md-type-${id}-tracking: ${step.tracking};`);
    }
  }

  const sizeGroups: [string, Record<string, string>][] = [
    ["App spacing (4px grid)", app.spacing],
    ["App radius", app.radius],
    ["App control heights", app.control],
    ["App page (A4 document sheet)", app.page],
  ];
  for (const [label, group] of sizeGroups) {
    lines.push(`\n  /* ${label} */`);
    for (const [key, val] of Object.entries(group)) {
      lines.push(`  --md-${cssIdent(key)}: ${val};`);
    }
  }

  lines.push("\n  /* App document family */");
  lines.push(`  --md-document-family: var(--font-${app.document.family});`);

  lines.push("\n  /* App motion (ease-out) */");
  lines.push(`  --md-motion-state: ${app.motion.state};`);
  lines.push(`  --md-motion-enter: ${app.motion.enter};`);
  lines.push("");
  lines.push(...appThemedVars("light"));
  lines.push("}\n");

  // `motion.reduced: none` — honour prefers-reduced-motion by collapsing
  // both durations rather than emitting a token named "reduced".
  if (app.motion.reduced === "none") {
    lines.push("@media (prefers-reduced-motion: reduce) {");
    lines.push("  :root {");
    lines.push("    --md-motion-state: 0ms;");
    lines.push("    --md-motion-enter: 0ms;");
    lines.push("  }");
    lines.push("}\n");
  }

  lines.push('[data-theme="dark"] {');
  lines.push(...appThemedVars("dark"));
  lines.push("}\n");

  lines.push("/* App type-scale classes */");
  for (const [name, step] of Object.entries(app.scale)) {
    const id = cssIdent(name);
    const decls = [
      `font-family: ${appFamily(name, step)};`,
      `font-size: var(--md-type-${id}-size);`,
      `line-height: var(--md-type-${id}-leading);`,
      `font-weight: var(--md-type-${id}-weight);`,
    ];
    if (step.tracking) {
      decls.push(`letter-spacing: var(--md-type-${id}-tracking);`);
    }
    if (step.style) decls.push(`font-style: ${step.style};`);
    lines.push(`.app-${id} { ${decls.join(" ")} }`);
  }

  lines.push("");
  return lines.join("\n") + "\n";
}

// ── Write files ─────────────────────────────────────────────────────────

await Deno.mkdir(CSS_DIR, { recursive: true });

const writes: [string, string][] = [
  [join(TYPST_DIR, "tokens.typ"), genTypstTokens()],
  [
    join(TYPST_DIR, "themes/light.typ"),
    genTypstTheme("light", tokens.themes.light),
  ],
  [
    join(TYPST_DIR, "themes/dark.typ"),
    genTypstTheme("dark", tokens.themes.dark),
  ],
  [join(CSS_DIR, "markspec.css"), genCss()],
];

for (const [path, content] of writes) {
  await Deno.writeTextFile(path, content);
  const rel = path.replace(ROOT + "/", "");
  console.log(`  wrote ${rel}`);
}

// ── Generate VS Code workbench colors ───────────────────────────────────

const VSCODE_PACKAGE = join(ROOT, "editors/vscode/package.json");

interface VscodeColorDef {
  id: string;
  description: string;
  defaults: {
    dark: string;
    light: string;
    highContrast: string;
    highContrastLight: string;
  };
}

function genVscodeColors(): VscodeColorDef[] {
  const blue = tokens.diagram.blue;
  const labelColors: VscodeColorDef[] = [
    {
      id: "markspec.label.background",
      description: "Background colour for label pills in MarkSpec entries.",
      defaults: {
        dark: `${blue.screen}22`,
        light: `${blue.print}1A`,
        highContrast: `${blue.screen}33`,
        highContrastLight: `${blue.print}1A`,
      },
    },
    {
      id: "markspec.label.foreground",
      description: "Foreground (text) colour for label pills.",
      defaults: {
        dark: "editorForeground",
        light: "editorForeground",
        highContrast: "editorForeground",
        highContrastLight: "editorForeground",
      },
    },
    {
      id: "markspec.label.border",
      description: "Border colour for valid label pills.",
      defaults: {
        dark: blue.screen,
        light: blue.print,
        highContrast: blue.screen,
        highContrastLight: blue.print,
      },
    },
    {
      id: "markspec.label.invalidBorder",
      description:
        "Border colour for label pills whose value is not in the active profile catalog.",
      defaults: {
        dark: "errorForeground",
        light: "errorForeground",
        highContrast: "errorForeground",
        highContrastLight: "errorForeground",
      },
    },
  ];

  // Admonition colours sourced from the existing tokens.alerts palette
  // (Paul Tol bright for light themes, vibrant for dark themes). On
  // dark themes the alert.bg is too bright for an editor background,
  // so we use the border hue with a low alpha tint instead.
  const admonitionKinds = [
    "note",
    "tip",
    "important",
    "warning",
    "caution",
  ] as const;
  const admonitionColors: VscodeColorDef[] = [];
  for (const kind of admonitionKinds) {
    const alert = tokens.alerts[kind];
    admonitionColors.push({
      id: `markspec.admonition.${kind}.border`,
      description:
        `Border colour for ${kind} admonitions (> [!${kind.toUpperCase()}]) in MarkSpec entries.`,
      defaults: {
        dark: alert.screen.border,
        light: alert.print.border,
        highContrast: alert.screen.border,
        highContrastLight: alert.print.border,
      },
    });
    admonitionColors.push({
      id: `markspec.admonition.${kind}.background`,
      description:
        `Background tint for ${kind} admonitions in MarkSpec entries.`,
      defaults: {
        dark: `${alert.screen.border}1A`,
        light: alert.print.bg,
        highContrast: `${alert.screen.border}33`,
        highContrastLight: alert.print.bg,
      },
    });
  }
  admonitionColors.push({
    id: "markspec.admonition.plain.border",
    description: "Border colour for plain blockquotes (no [!KIND] marker).",
    defaults: {
      dark: "editorLineNumber.foreground",
      light: "editorLineNumber.foreground",
      highContrast: "editorLineNumber.foreground",
      highContrastLight: "editorLineNumber.foreground",
    },
  });
  admonitionColors.push({
    id: "markspec.admonition.plain.background",
    description: "Background tint for plain blockquotes.",
    defaults: {
      dark: "#BBBBBB14",
      light: "#88888814",
      highContrast: "#BBBBBB22",
      highContrastLight: "#88888822",
    },
  });

  // Left-bar colour painted at column 0 of every entry line (title
  // through last trailer line). Materialises the entry boundary
  // without an intrusive background fill. Neutral by default; users
  // can override per-theme via workbench.colorCustomizations.
  const entryColors: VscodeColorDef[] = [
    {
      id: "markspec.entry.border",
      description:
        "Colour of the 3px left-bar that marks each MarkSpec entry block.",
      defaults: {
        dark: "editorIndentGuide.activeBackground",
        light: "editorIndentGuide.activeBackground",
        highContrast: "editorIndentGuide.activeBackground",
        highContrastLight: "editorIndentGuide.activeBackground",
      },
    },
  ];

  return [...labelColors, ...admonitionColors, ...entryColors];
}

async function writeVscodeColors(): Promise<void> {
  const existing = await Deno.readTextFile(VSCODE_PACKAGE);
  const pkg = JSON.parse(existing) as {
    contributes?: { colors?: VscodeColorDef[] };
  };
  if (!pkg.contributes) pkg.contributes = {};
  pkg.contributes.colors = genVscodeColors();
  const text = JSON.stringify(pkg, null, 2) + "\n";
  if (text !== existing) {
    await Deno.writeTextFile(VSCODE_PACKAGE, text);
  }
}

await writeVscodeColors();

/**
 * Generate Typst and CSS theme files from docs/spec/tokens.yaml.
 *
 * Usage: deno run --allow-read --allow-write scripts/gen_theme.ts
 */

import { parse } from "jsr:@std/yaml@^1";
import { dirname, fromFileUrl, join } from "jsr:@std/path@^1";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const TOKENS_PATH = join(ROOT, "docs/spec/tokens.yaml");
const TYPST_DIR = join(ROOT, "packages/markspec-typst");
const CSS_DIR = join(ROOT, "docs/theme");

const HEADER_TYPST = "// Generated from docs/spec/tokens.yaml — do not edit.\n";
const HEADER_CSS = "/* Generated from docs/spec/tokens.yaml — do not edit. */\n";

// ── Load tokens ─────────────────────────────────────────────────────────

interface Tokens {
  fonts: Record<string, string[]>;
  scale: Record<string, { size: string; weight: string; leading: string }>;
  spacing: Record<string, string>;
  page: Record<string, string>;
  slide: Record<string, string>;
  themes: Record<string, Record<string, string>>;
  alerts: Record<string, { border: string; bg: string }>;
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

function ptToRem(pt: string): string {
  const val = parseFloat(pt);
  return (val / 16).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + "rem";
}

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

  // Alert border colors from the alerts section
  lines.push("\n// Alert border colors (Tol palette)");
  for (const [name, props] of Object.entries(tokens.alerts)) {
    lines.push(`#let alert-${name} = rgb("${props.border}")`);
  }

  lines.push("");
  return lines.join("\n") + "\n";
}

// ── Generate CSS ────────────────────────────────────────────────────────

function genCss(): string {
  const lines: string[] = [HEADER_CSS, ":root {"];

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

  // Light theme (default)
  lines.push("\n  /* Light theme (default) */");
  for (const [key, val] of Object.entries(tokens.themes.light)) {
    lines.push(`  --${key}: ${val};`);
  }

  // Alerts
  lines.push("\n  /* Alert colors */");
  for (const [name, props] of Object.entries(tokens.alerts)) {
    lines.push(`  --alert-${name}-border: ${props.border};`);
    lines.push(`  --alert-${name}-bg: ${props.bg};`);
  }

  lines.push("}\n");

  // Dark theme
  lines.push('[data-theme="dark"] {');
  for (const [key, val] of Object.entries(tokens.themes.dark)) {
    lines.push(`  --${key}: ${val};`);
  }
  lines.push("}\n");

  // mdBook overrides
  lines.push("/* ── mdBook overrides ───────────────────────────────────── */\n");
  lines.push(":root {");
  lines.push("  --mono-font: var(--font-mono);");
  lines.push("  --links: var(--accent);");
  lines.push("}\n");
  lines.push(".light, .rust {");
  lines.push("  --bg: var(--bg);");
  lines.push("  --fg: var(--text);");
  lines.push("  --sidebar-bg: #f5f5f5;");
  lines.push("  --sidebar-fg: var(--text);");
  lines.push("  --sidebar-active: var(--accent);");
  lines.push("  --links: var(--accent);");
  lines.push("  --inline-code-color: var(--text);");
  lines.push("  --theme-popup-bg: #ffffff;");
  lines.push("  --theme-popup-border: var(--border);");
  lines.push("  --quote-bg: var(--bg-alert);");
  lines.push("  --quote-border: var(--border);");
  lines.push("  --table-border-color: var(--border);");
  lines.push("  --table-header-bg: var(--bg-code);");
  lines.push("}\n");
  lines.push(".navy, .ayu, .coal {");
  lines.push("  --links: var(--accent);");
  lines.push("  --inline-code-color: #e4e4e4;");
  lines.push("}\n");

  // Base typography
  lines.push("/* ── Base typography ────────────────────────────────────── */\n");
  lines.push("body { font-family: var(--font-sans); }");
  lines.push("code, pre > code { font-family: var(--font-mono); }");
  lines.push(
    `h1 { font-size: ${ptToRem(tokens.scale.h1.size)}; font-weight: 600; }`,
  );
  lines.push(
    `h2 { font-size: ${ptToRem(tokens.scale.h2.size)}; font-weight: 600; }`,
  );
  lines.push(
    `h3 { font-size: ${ptToRem(tokens.scale.h3.size)}; font-weight: 600; }`,
  );
  lines.push(
    `h4 { font-size: ${ptToRem(tokens.scale.h4.size)}; font-weight: 600; }`,
  );

  lines.push("");
  return lines.join("\n") + "\n";
}

// ── Write files ─────────────────────────────────────────────────────────

await Deno.mkdir(CSS_DIR, { recursive: true });

const writes: [string, string][] = [
  [join(TYPST_DIR, "tokens.typ"), genTypstTokens()],
  [join(TYPST_DIR, "themes/light.typ"), genTypstTheme("light", tokens.themes.light)],
  [join(TYPST_DIR, "themes/dark.typ"), genTypstTheme("dark", tokens.themes.dark)],
  [join(CSS_DIR, "markspec.css"), genCss()],
];

for (const [path, content] of writes) {
  await Deno.writeTextFile(path, content);
  const rel = path.replace(ROOT + "/", "");
  console.log(`  wrote ${rel}`);
}

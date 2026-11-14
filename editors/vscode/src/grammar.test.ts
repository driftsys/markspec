import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

interface Capture {
  name?: string;
}
interface Rule {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  include?: string;
  captures?: Record<string, Capture>;
  beginCaptures?: Record<string, Capture>;
  patterns?: Rule[];
}
interface Grammar {
  scopeName: string;
  patterns: Rule[];
  repository: Record<string, Rule>;
}

const grammar = JSON.parse(
  readFileSync(join(ROOT, "syntaxes", "feature.tmLanguage.json"), "utf8"),
) as Grammar;

const manifest = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as {
  contributes: {
    grammars?: { language?: string; scopeName: string; path: string }[];
  };
};

function resolve(rule: Rule): Rule {
  if (rule.include?.startsWith("#")) {
    return grammar.repository[rule.include.slice(1)];
  }
  return rule;
}

/**
 * A small tokenizer for the line shapes the grammar covers. Inside a
 * begin/end rule only that rule's patterns apply; a whole-line rule or a
 * block opener ends the scan, any other rule lets it continue.
 */
function scopesPerLine(lines: string[]): string[][] {
  const stack: Rule[] = [];
  return lines.map((line) => {
    const scopes: string[] = [];
    const top = stack[stack.length - 1];
    if (top?.end) {
      const closer = new RegExp(top.end.replace("\\1", fenceOf(top)));
      if (closer.test(line)) {
        stack.pop();
        if (top.begin?.includes('\\s*("""')) {
          // A doc-string closer belongs to the doc string.
          scopes.push(top.name ?? "");
          return scopes;
        }
        // Zero-width closers (header blocks) re-read the line below.
      } else {
        if (top.name) scopes.push(top.name);
        const inner = (top.patterns ?? []).map(resolve);
        apply(inner, line, scopes, stack);
        return scopes;
      }
    }
    apply(grammar.patterns.map(resolve), line, scopes, stack);
    return scopes;
  });
}

const fences = new WeakMap<Rule, string>();
function fenceOf(rule: Rule): string {
  return fences.get(rule) ?? "";
}

function apply(
  rules: Rule[],
  line: string,
  scopes: string[],
  stack: Rule[],
): void {
  for (const raw of rules) {
    const rule = resolve(raw);
    if (rule.patterns && !rule.match && !rule.begin) {
      const before = scopes.length;
      apply(rule.patterns.map(resolve), line, scopes, stack);
      if (scopes.length > before) return;
      continue;
    }
    const source = rule.match ?? rule.begin!;
    const m = new RegExp(source).exec(line);
    if (!m) continue;
    if (rule.name) scopes.push(rule.name);
    const caps = rule.captures ?? rule.beginCaptures ?? {};
    for (const [index, cap] of Object.entries(caps)) {
      if (cap.name && m[Number(index)] !== undefined) {
        scopes.push(`${cap.name}=${m[Number(index)]}`);
      }
    }
    if (rule.begin) {
      fences.set(rule, m[1] ?? "");
      stack.push(rule);
    }
    // A rule that matches the whole line, or opens a block, ends the scan.
    if (rule.begin || source.endsWith("$")) return;
  }
}

function scopesOf(line: string): string[] {
  return scopesPerLine([line])[0];
}

test("scope name is namespaced and the grammar is contributed", () => {
  assert.equal(grammar.scopeName, "source.feature.markspec");
  const entry = manifest.contributes.grammars?.find((g) =>
    g.language === "feature"
  );
  assert.ok(entry, "grammars has an entry for feature");
  assert.equal(entry.scopeName, "source.feature.markspec");
  assert.equal(entry.path, "./syntaxes/feature.tmLanguage.json");
});

test("header line scopes the display ID and the title", () => {
  const s = scopesOf("# [SWT_LIGHT_0001] Light turns on");
  assert.ok(
    s.includes("entity.name.tag.markspec.display-id=SWT_LIGHT_0001"),
    s.join("|"),
  );
  assert.ok(s.includes("markup.heading.markspec=Light turns on"), s.join("|"));
});

test("an indented header is a header", () => {
  const s = scopesOf("  # [TST_0002] T");
  assert.ok(s.some((x) => x.startsWith("entity.name.tag.markspec.display-id")));
});

test("bracketed comments that are not display IDs are not headers", () => {
  for (const line of ["# [TODO] x", "# [x]", "# [SC/A_1] x", "# [WIP] later"]) {
    const s = scopesOf(line);
    assert.equal(
      s.some((x) => x.includes("markspec")),
      false,
      `${line} -> ${s.join("|")}`,
    );
    assert.ok(s.some((x) => x.startsWith("comment.line.number-sign")), line);
  }
});

test("trailer lines after a header scope key and value", () => {
  const s = scopesPerLine([
    "# [SWT_LIGHT_0001] Light turns on",
    "#",
    "#     Satisfies: SWE_0001",
  ])[2];
  assert.ok(
    s.includes("keyword.other.markspec.trailer-key=Satisfies"),
    s.join("|"),
  );
  assert.ok(
    s.includes("string.unquoted.markspec.trailer-value=SWE_0001"),
    s.join("|"),
  );
});

test("git-style trailer without indent also scopes", () => {
  const s = scopesPerLine(["# [SC_A_1] T", "# Labels: ASIL-B"])[1];
  assert.ok(
    s.includes("keyword.other.markspec.trailer-key=Labels"),
    s.join("|"),
  );
});

test("a plain comment is only a comment", () => {
  assert.deepEqual(scopesOf("# plain comment"), [
    "comment.line.number-sign.feature",
  ]);
  const after = scopesPerLine(["Scenario: S", "# Note: text"])[1];
  assert.deepEqual(after, ["comment.line.number-sign.feature"]);
});

test("a key-like comment outside a header is not a trailer", () => {
  const after = scopesPerLine(["Feature: F", "", "# TODO: fix"])[2];
  assert.equal(after.some((x) => x.includes("trailer")), false);
});

test("a trailer block ends at the first non-comment line", () => {
  const s = scopesPerLine(["# [SC_A_1] T", "Scenario: S", "# Key: v"])[2];
  assert.equal(s.some((x) => x.includes("trailer")), false);
});

test("a header after a header starts a new header", () => {
  const s = scopesPerLine(["# [SC_A_1] T", "# [SC_A_2] U"])[1];
  assert.ok(
    s.includes("entity.name.tag.markspec.display-id=SC_A_2"),
    s.join("|"),
  );
});

test("keywords", () => {
  for (
    const [line, word] of [
      ["Feature: F", "Feature"],
      ["  Rule: R", "Rule"],
      ["  Background:", "Background"],
      ["  Scenario: S", "Scenario"],
      ["  Scenario Outline: S", "Scenario Outline"],
      ["    Examples:", "Examples"],
      ["    Given a thing", "Given"],
      ["    When a thing", "When"],
      ["    Then a thing", "Then"],
      ["    And a thing", "And"],
      ["    But a thing", "But"],
      ["    * a thing", "*"],
    ]
  ) {
    const s = scopesOf(line);
    assert.ok(
      s.some((x) => x.startsWith("keyword.") && x.endsWith(`=${word}`)),
      `${line} -> ${s.join("|")}`,
    );
  }
});

test("tags", () => {
  const s = scopesOf("  @smoke @slow");
  assert.ok(
    s.some((x) => x.startsWith("entity.name.tag.feature")),
    s.join("|"),
  );
});

test("outline parameter", () => {
  const s = scopesOf("    Given <count> items");
  assert.ok(s.includes("variable.parameter.feature"), s.join("|"));
});

test("table row", () => {
  const s = scopesOf("      | a | b |");
  assert.ok(s.some((x) => x.startsWith("markup.table.feature")), s.join("|"));
});

test("doc string content gets no header or trailer scopes", () => {
  const out = scopesPerLine([
    '    """',
    "    # [SC_A_1] not a header",
    "    # Key: value",
    "    @notatag <p>",
    '    """',
    "    # [SC_A_2] real",
  ]);
  for (const i of [1, 2, 3]) {
    assert.deepEqual(
      out[i],
      ["string.quoted.docstring.feature"],
      out[i].join("|"),
    );
  }
  assert.ok(
    out[5].some((x) => x.startsWith("entity.name.tag.markspec.display-id")),
  );
});

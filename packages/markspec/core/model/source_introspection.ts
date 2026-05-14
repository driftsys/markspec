/**
 * @module model/source_introspection
 *
 * `Source:` → core type inference per spec §1.3.1 step 3 and
 * ADR-003 §Part 5. Returns the inferred core type when the
 * `Source:` value looks like a recognised manifest, source-code
 * file, interface description, or bus description; `undefined`
 * otherwise.
 *
 * Match order is significant — manifests must run before generic
 * extension matches so `path/to/something.json` doesn't shadow
 * `package.json`. The list is conservative: only patterns ADR-003
 * §Part 5 lists normatively are encoded here; profiles extend the
 * map later.
 */

interface SourcePattern {
  readonly pattern: RegExp;
  readonly type: string;
}

const SOURCE_PATTERNS: readonly SourcePattern[] = [
  // Build manifests → SoftwareComponent. Anchored at filename
  // boundary so `weird-Cargo.toml` doesn't match unintentionally.
  { pattern: /(?:^|\/)Cargo\.toml$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)package\.json$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)pom\.xml$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)deno\.json$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)go\.mod$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)pyproject\.toml$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)setup\.py$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)pubspec\.yaml$/, type: "SoftwareComponent" },
  { pattern: /(?:^|\/)[^/]+\.csproj$/, type: "SoftwareComponent" },

  // Interface description files → SoftwareInterface. Run BEFORE the
  // generic source-code extensions so `.openapi.yaml` wins over `.yaml`.
  { pattern: /\.openapi\.(?:yaml|yml|json)$/, type: "SoftwareInterface" },
  { pattern: /\.asyncapi\.(?:yaml|yml|json)$/, type: "SoftwareInterface" },
  { pattern: /\.proto$/, type: "SoftwareInterface" },
  { pattern: /\.graphql$/, type: "SoftwareInterface" },
  { pattern: /\.wsdl$/, type: "SoftwareInterface" },
  { pattern: /\.arxml$/, type: "SoftwareInterface" },
  { pattern: /\.idl$/, type: "SoftwareInterface" },
  { pattern: /\.ridl$/, type: "SoftwareInterface" },

  // Bus description files → HardwareInterface.
  { pattern: /\.dbc$/, type: "HardwareInterface" },
  { pattern: /\.ldf$/, type: "HardwareInterface" },
  { pattern: /\.fibex$/, type: "HardwareInterface" },

  // Source-code files → SoftwareUnit.
  { pattern: /\.rs$/, type: "SoftwareUnit" },
  { pattern: /\.kt$/, type: "SoftwareUnit" },
  { pattern: /\.kts$/, type: "SoftwareUnit" },
  { pattern: /\.java$/, type: "SoftwareUnit" },
  { pattern: /\.py$/, type: "SoftwareUnit" },
  { pattern: /\.ts$/, type: "SoftwareUnit" },
  { pattern: /\.tsx$/, type: "SoftwareUnit" },
  { pattern: /\.js$/, type: "SoftwareUnit" },
  { pattern: /\.jsx$/, type: "SoftwareUnit" },
  { pattern: /\.go$/, type: "SoftwareUnit" },
  { pattern: /\.cpp$/, type: "SoftwareUnit" },
  { pattern: /\.cc$/, type: "SoftwareUnit" },
  { pattern: /\.cxx$/, type: "SoftwareUnit" },
  { pattern: /\.c$/, type: "SoftwareUnit" },
  { pattern: /\.h$/, type: "SoftwareUnit" },
  { pattern: /\.hpp$/, type: "SoftwareUnit" },
  { pattern: /\.hxx$/, type: "SoftwareUnit" },
];

/**
 * Infer a core type from a `Source:` attribute value. The value
 * may be a filesystem path or a URI — only the filename portion
 * is matched. Whitespace is trimmed before matching.
 *
 * Returns `undefined` when no pattern matches; callers should treat
 * that as "Source: didn't classify" and fall through to step 4 of
 * the resolution chain.
 */
export function inferTypeFromSource(source: string): string | undefined {
  const trimmed = source.trim();
  for (const { pattern, type } of SOURCE_PATTERNS) {
    if (pattern.test(trimmed)) return type;
  }
  return undefined;
}

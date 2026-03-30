/**
 * Check for grammar version updates and optionally apply them.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env scripts/update_grammars.ts
 *   deno run --allow-net --allow-read --allow-write --allow-env --allow-run scripts/update_grammars.ts --apply
 *
 * Default (dry-run): prints a JSON summary of available updates to stdout.
 * With --apply: rewrites version strings in fetch_grammars.ts, then runs
 * the fetch script to download updated grammars and regenerate the lockfile.
 */

interface Update {
  file: string;
  source: "npm" | "github";
  package: string;
  current: string;
  latest: string;
}

interface GrammarEntry {
  source: "npm" | "github";
  package: string;
  version: string;
}

const FETCH_SCRIPT = new URL("./fetch_grammars.ts", import.meta.url).pathname;

/** Parse the GRAMMARS config from fetch_grammars.ts source text. */
function parseGrammars(source: string): Record<string, GrammarEntry> {
  const grammars: Record<string, GrammarEntry> = {};

  // Match npm entries: "file.wasm": { source: "npm", pkg: "...", version: "..." }
  const npmRe =
    /"([^"]+\.wasm)":\s*\{[^}]*source:\s*"npm"[^}]*pkg:\s*"([^"]+)"[^}]*version:\s*"([^"]+)"/g;
  for (const m of source.matchAll(npmRe)) {
    grammars[m[1]] = { source: "npm", package: m[2], version: m[3] };
  }

  // Match github entries: "file.wasm": { source: "github", repo: "...", tag: "..." }
  const ghRe =
    /"([^"]+\.wasm)":\s*\{[^}]*source:\s*"github"[^}]*repo:\s*"([^"]+)"[^}]*tag:\s*"([^"]+)"/g;
  for (const m of source.matchAll(ghRe)) {
    grammars[m[1]] = { source: "github", package: m[2], version: m[3] };
  }

  return grammars;
}

/** Get the latest version from npm registry. */
async function latestNpmVersion(pkg: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
  if (!res.ok) throw new Error(`npm registry error for ${pkg}: ${res.status}`);
  const json = await res.json();
  return json.version;
}

/** Get the latest release tag from GitHub. */
async function latestGithubTag(repo: string): Promise<string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
  };
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers },
  );
  if (!res.ok) throw new Error(`GitHub API error for ${repo}: ${res.status}`);
  const json = await res.json();
  return json.tag_name;
}

/** Apply version updates to the fetch script source text. */
function applyUpdates(source: string, updates: Update[]): string {
  let result = source;
  for (const u of updates) {
    if (u.source === "npm") {
      // Replace: pkg: "tree-sitter-rust", version: "0.24.0"
      const pattern = new RegExp(
        `(pkg:\\s*"${u.package.replace("/", "\\/")}"[^}]*version:\\s*")${
          u.current.replace(".", "\\.")
        }(")`,
      );
      result = result.replace(pattern, `$1${u.latest}$2`);
    } else {
      // Replace: repo: "fwcd/tree-sitter-kotlin", tag: "0.3.8"
      const pattern = new RegExp(
        `(repo:\\s*"${u.package.replace("/", "\\/")}"[^}]*tag:\\s*")${
          u.current.replace(".", "\\.")
        }(")`,
      );
      result = result.replace(pattern, `$1${u.latest}$2`);
    }
  }
  return result;
}

// --- main ---

const source = await Deno.readTextFile(FETCH_SCRIPT);
const grammars = parseGrammars(source);

if (Object.keys(grammars).length === 0) {
  console.error("error: could not parse any grammars from fetch_grammars.ts");
  Deno.exit(1);
}

console.error("Checking for grammar updates...\n");

const updates: Update[] = [];

for (const [file, g] of Object.entries(grammars)) {
  const latest = g.source === "npm"
    ? await latestNpmVersion(g.package)
    : await latestGithubTag(g.package);

  if (latest !== g.version) {
    console.error(`  ${file}: ${g.version} → ${latest}`);
    updates.push({
      file,
      source: g.source,
      package: g.package,
      current: g.version,
      latest,
    });
  } else {
    console.error(`  ${file}: ${g.version} (up to date)`);
  }
}

const summary = { up_to_date: updates.length === 0, updates };
console.log(JSON.stringify(summary, null, 2));

if (updates.length === 0) {
  console.error("\nAll grammars are up to date.");
  Deno.exit(0);
}

if (!Deno.args.includes("--apply")) {
  console.error(
    `\n${updates.length} update(s) available. Run with --apply to update.`,
  );
  Deno.exit(0);
}

// Apply updates
console.error("\nApplying updates...");
const updated = applyUpdates(source, updates);
await Deno.writeTextFile(FETCH_SCRIPT, updated);
console.error("  updated scripts/fetch_grammars.ts");

// Run fetch to download new versions and regenerate lockfile
console.error("  running fetch...\n");
const cmd = new Deno.Command("deno", {
  args: ["task", "fetch-grammars"],
  stdout: "inherit",
  stderr: "inherit",
});
const result = await cmd.output();
if (!result.success) {
  console.error("error: fetch failed");
  Deno.exit(1);
}

console.error("\nDone.");

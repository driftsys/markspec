/**
 * Download pre-built tree-sitter WASM grammar files to grammars/.
 *
 * Usage: deno run --allow-net --allow-write --allow-read scripts/fetch_grammars.ts
 *
 * Most grammars are fetched from npm via jsdelivr CDN. Kotlin is fetched
 * from its GitHub Release (upstream npm package does not include WASM).
 *
 * After fetching, writes grammars/grammars.lock with SHA-256 hashes
 * for traceability and CI cache keying.
 */

interface NpmGrammar {
  source: "npm";
  pkg: string;
  version: string;
  /**
   * Filename inside the npm package, if it differs from the on-disk
   * name used as the GRAMMARS map key. Upstream tree-sitter-c-sharp
   * ships its WASM as `tree-sitter-c_sharp.wasm` (C-identifier form
   * of "c#"); we save it as `tree-sitter-c-sharp.wasm` for naming
   * consistency with the other grammars.
   */
  urlFile?: string;
}

interface GithubGrammar {
  source: "github";
  repo: string;
  tag: string;
}

type Grammar = NpmGrammar | GithubGrammar;

interface LockEntry {
  file: string;
  source: "npm" | "github";
  package: string;
  version: string;
  sha256: string;
}

const GRAMMARS: Record<string, Grammar> = {
  "tree-sitter-rust.wasm": {
    source: "npm",
    pkg: "tree-sitter-rust",
    version: "0.24.0",
  },
  "tree-sitter-kotlin.wasm": {
    source: "github",
    repo: "fwcd/tree-sitter-kotlin",
    tag: "0.3.8",
  },
  "tree-sitter-java.wasm": {
    source: "npm",
    pkg: "tree-sitter-java",
    version: "0.23.5",
  },
  "tree-sitter-c.wasm": {
    source: "npm",
    pkg: "tree-sitter-c",
    version: "0.24.1",
  },
  "tree-sitter-cpp.wasm": {
    source: "npm",
    pkg: "tree-sitter-cpp",
    version: "0.23.4",
  },
  // tree-sitter-typescript ships two wasm files in the same npm package
  // (TypeScript + TSX); same pkg/version produces both rows below.
  //
  // Pinned at 0.23.x — newer tree-sitter-typescript / tree-sitter-javascript
  // releases emit tree-sitter language v15, which the current
  // web-tree-sitter@^0.24 cannot load (max supported language version is 14).
  // When web-tree-sitter bumps past v14, revisit and consider tree-sitter-
  // typescript@0.23.x → 0.24.x and tree-sitter-javascript@0.23.1 → 0.25.x.
  "tree-sitter-typescript.wasm": {
    source: "npm",
    pkg: "tree-sitter-typescript",
    version: "0.23.2",
  },
  "tree-sitter-tsx.wasm": {
    source: "npm",
    pkg: "tree-sitter-typescript",
    version: "0.23.2",
  },
  "tree-sitter-javascript.wasm": {
    source: "npm",
    pkg: "tree-sitter-javascript",
    version: "0.23.1",
  },
  "tree-sitter-c-sharp.wasm": {
    source: "npm",
    pkg: "tree-sitter-c-sharp",
    version: "0.23.1",
    // Upstream package ships its WASM with an underscore
    // (tree-sitter-c_sharp.wasm); we save it with a hyphen to match
    // the naming of the other grammars. Pinned to 0.23.1 because the
    // newer 0.23.5 requires tree-sitter language ABI v15 while
    // web-tree-sitter@0.24 only loads up to v14.
    urlFile: "tree-sitter-c_sharp.wasm",
  },
};

const GRAMMARS_DIR = new URL("../grammars", import.meta.url).pathname;
const LOCK_PATH = `${GRAMMARS_DIR}/grammars.lock`;

/**
 * With `--write-lock`, freshly-computed hashes are written to
 * `grammars.lock` (used by `update_grammars.ts --apply` after a version
 * bump). Without it, the default is a *verifying* fetch: each downloaded
 * file's sha256 must match the hash already pinned in `grammars.lock`, or
 * the script exits non-zero. This makes the build-time fetch
 * tamper-evident — a CDN compromise or accidental version drift fails
 * loudly instead of silently shipping unexpected bytes.
 */
const WRITE_LOCK = Deno.args.includes("--write-lock");

/** Read the pinned `file → sha256` map from the committed lockfile. */
async function readLockedHashes(): Promise<Map<string, string>> {
  try {
    const raw = await Deno.readTextFile(LOCK_PATH);
    const parsed = JSON.parse(raw) as { grammars?: LockEntry[] };
    const map = new Map<string, string>();
    for (const entry of parsed.grammars ?? []) {
      map.set(entry.file, entry.sha256);
    }
    return map;
  } catch {
    return new Map();
  }
}

function grammarUrl(file: string, grammar: Grammar): string {
  if (grammar.source === "npm") {
    const urlFile = grammar.urlFile ?? file;
    return `https://cdn.jsdelivr.net/npm/${grammar.pkg}@${grammar.version}/${urlFile}`;
  }
  return `https://github.com/${grammar.repo}/releases/download/${grammar.tag}/${file}`;
}

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchGrammar(
  file: string,
  grammar: Grammar,
): Promise<LockEntry> {
  const url = grammarUrl(file, grammar);
  const pkg = grammar.source === "npm" ? grammar.pkg : grammar.repo;
  const version = grammar.source === "npm" ? grammar.version : grammar.tag;
  const label = `${pkg}@${version}`;

  console.error(`  fetching ${file} from ${label}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  await Deno.writeFile(`${GRAMMARS_DIR}/${file}`, data);
  const digest = await sha256(data);
  console.error(
    `  wrote ${file} (${(data.length / 1024).toFixed(0)} KB) sha256:${
      digest.slice(0, 12)
    }...`,
  );

  return {
    file,
    source: grammar.source,
    package: pkg,
    version,
    sha256: digest,
  };
}

console.error("Fetching tree-sitter WASM grammars...\n");

const entries: LockEntry[] = [];
for (const [file, grammar] of Object.entries(GRAMMARS)) {
  entries.push(await fetchGrammar(file, grammar));
}

if (WRITE_LOCK) {
  const lock = { generated: new Date().toISOString(), grammars: entries };
  await Deno.writeTextFile(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");
  console.error("\nWrote grammars/grammars.lock");
} else {
  // Verifying fetch: every downloaded file must match the pinned hash.
  const locked = await readLockedHashes();
  const mismatches: string[] = [];
  for (const entry of entries) {
    const expected = locked.get(entry.file);
    if (expected === undefined) {
      mismatches.push(
        `${entry.file}: no entry in grammars.lock (run with --write-lock to record it)`,
      );
    } else if (expected !== entry.sha256) {
      mismatches.push(
        `${entry.file}: sha256 mismatch\n      expected ${expected}\n      got      ${entry.sha256}`,
      );
    }
  }
  if (mismatches.length > 0) {
    console.error("\nerror: fetched grammars do not match grammars.lock:");
    for (const m of mismatches) console.error(`  ${m}`);
    console.error(
      "\nIf this is an intentional version bump, re-run with --write-lock:\n" +
        "  deno task fetch-grammars -- --write-lock",
    );
    Deno.exit(1);
  }
  console.error("\nVerified all grammars against grammars.lock.");
}

console.error("Done.");

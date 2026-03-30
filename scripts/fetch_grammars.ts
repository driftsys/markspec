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
    version: "0.23.5",
  },
  "tree-sitter-cpp.wasm": {
    source: "npm",
    pkg: "tree-sitter-cpp",
    version: "0.23.4",
  },
};

const GRAMMARS_DIR = new URL("../grammars", import.meta.url).pathname;

function grammarUrl(file: string, grammar: Grammar): string {
  if (grammar.source === "npm") {
    return `https://cdn.jsdelivr.net/npm/${grammar.pkg}@${grammar.version}/${file}`;
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

const lock = { generated: new Date().toISOString(), grammars: entries };
await Deno.writeTextFile(
  `${GRAMMARS_DIR}/grammars.lock`,
  JSON.stringify(lock, null, 2) + "\n",
);
console.error("\nWrote grammars/grammars.lock");
console.error("Done.");

/**
 * Download pre-built tree-sitter WASM grammar files to grammars/.
 *
 * Usage: deno run --allow-net --allow-write scripts/fetch_grammars.ts
 *
 * Most grammars are fetched from npm via jsdelivr CDN. Kotlin is fetched
 * from its GitHub Release (upstream npm package does not include WASM).
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

async function fetchGrammar(file: string, grammar: Grammar) {
  const url = grammarUrl(file, grammar);
  const label = grammar.source === "npm"
    ? `${grammar.pkg}@${grammar.version}`
    : `${grammar.repo}@${grammar.tag}`;
  console.error(`  fetching ${file} from ${label}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  await Deno.writeFile(`${GRAMMARS_DIR}/${file}`, data);
  console.error(`  wrote ${file} (${(data.length / 1024).toFixed(0)} KB)`);
}

console.error("Fetching tree-sitter WASM grammars...\n");

for (const [file, grammar] of Object.entries(GRAMMARS)) {
  await fetchGrammar(file, grammar);
}

console.error("\nDone.");

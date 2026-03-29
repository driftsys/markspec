/**
 * Download pre-built tree-sitter WASM grammar files to grammars/.
 *
 * Usage: deno run --allow-net --allow-write scripts/fetch_grammars.ts
 *
 * Each grammar npm package (tree-sitter 0.23+) ships a pre-built WASM file.
 * Kotlin is excluded — its npm package does not include WASM yet.
 */

const GRAMMARS: Record<string, { pkg: string; version: string }> = {
  "tree-sitter-rust.wasm": { pkg: "tree-sitter-rust", version: "0.24.0" },
  "tree-sitter-java.wasm": { pkg: "tree-sitter-java", version: "0.23.5" },
  "tree-sitter-c.wasm": { pkg: "tree-sitter-c", version: "0.23.5" },
  "tree-sitter-cpp.wasm": { pkg: "tree-sitter-cpp", version: "0.23.4" },
};

const GRAMMARS_DIR = new URL("../grammars", import.meta.url).pathname;

async function fetchGrammar(file: string, pkg: string, version: string) {
  const url = `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${file}`;
  console.error(`  fetching ${file} from ${pkg}@${version}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  await Deno.writeFile(`${GRAMMARS_DIR}/${file}`, data);
  console.error(`  wrote ${file} (${(data.length / 1024).toFixed(0)} KB)`);
}

console.error("Fetching tree-sitter WASM grammars...\n");

for (const [file, { pkg, version }] of Object.entries(GRAMMARS)) {
  await fetchGrammar(file, pkg, version);
}

console.error("\nDone.");

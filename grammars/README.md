# Tree-sitter WASM Grammars

This directory holds pre-built tree-sitter WASM grammar files used by the source
parser to extract doc comments from code.

WASM files are **not** checked into git. Run the fetch script to download them:

```bash
deno run --allow-net --allow-write scripts/fetch_grammars.ts
```

Supported grammars:

| File                      | Language |
| ------------------------- | -------- |
| `tree-sitter-rust.wasm`   | Rust     |
| `tree-sitter-kotlin.wasm` | Kotlin   |
| `tree-sitter-java.wasm`   | Java     |
| `tree-sitter-c.wasm`      | C        |
| `tree-sitter-cpp.wasm`    | C++      |

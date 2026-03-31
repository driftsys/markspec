# Tree-sitter WASM Grammars

This directory holds pre-built tree-sitter WASM grammar files used by the source
parser to extract doc comments from code.

WASM files are committed via Git LFS. To update them, run:

```bash
deno task fetch-grammars
```

Supported grammars:

| File                      | Language |
| ------------------------- | -------- |
| `tree-sitter-rust.wasm`   | Rust     |
| `tree-sitter-kotlin.wasm` | Kotlin   |
| `tree-sitter-java.wasm`   | Java     |
| `tree-sitter-c.wasm`      | C        |
| `tree-sitter-cpp.wasm`    | C++      |

## Lockfile

`grammars.lock` records the source, version, and SHA-256 hash of each grammar.
The fetch script regenerates it on every run.

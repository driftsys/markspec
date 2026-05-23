# markspec-ide — VSCode extension

VSCode extension for [MarkSpec](https://github.com/driftsys/markspec). Provides
LSP-backed diagnostics, completions, hover, go-to-definition, references,
rename, document/workspace symbols, folding, document highlights, code actions,
and MCP integration for MarkSpec documents and source-file doc comments.

The extension bundles the platform-appropriate `markspec` binary (`markspec.exe`
on Windows, `markspec` elsewhere) and spawns it as a child process for the
`markspec lsp` and `markspec mcp` subcommands. The binary is selected at build
time via [`scripts/bundleBinary.ts`](scripts/bundleBinary.ts) and at runtime via
[`src/serverOptions.ts`](src/serverOptions.ts).

## Building

```bash
cd editors/vscode
npm install
npm run compile
```

To run from source against a freshly compiled CLI:

```bash
# from the repo root
just compile
# from editors/vscode, press F5 to launch an Extension Development Host
```

## Manual Windows smoke test — STK-WIN-0005

Run before each release on a clean Windows 11 (or 10 22H2) host:

1. **Install the CLI.**
   ```powershell
   irm https://raw.githubusercontent.com/driftsys/markspec/main/install.ps1 | iex
   ```
   Confirm `markspec --version` prints the expected version.

2. **Install the extension.** Use the Windows VSIX from the GitHub release
   (`markspec-ide-<version>-win32-x64.vsix`):
   ```powershell
   code --install-extension .\markspec-ide-<version>-win32-x64.vsix
   ```

3. **Open a MarkSpec project.** Clone the
   [examples repo](https://github.com/driftsys/markspec) and open
   `docs/examples/` in VSCode. The LSP indexer should fire on open and the
   status bar should report the entry count.

4. **Verify per-capability behaviour.** For each row, perform the action and
   record pass / fail. Every row must pass.

   | #  | Capability          | Test                                                                                                                |
   | -- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
   | 1  | Diagnostics         | Introduce a broken `Satisfies:` reference. A red squiggle and `MSL-…` diagnostic appear within 1 s.                 |
   | 2  | Completion (block)  | Type `- [` at the start of a list line. The entry-block scaffold completion appears.                                |
   | 3  | Completion (id)     | Type `Satisfies:` on a trailer line. A list of display IDs appears.                                                 |
   | 4  | Hover               | Hover a display ID. A Markdown preview of the target entry appears.                                                 |
   | 5  | Go to definition    | F12 on a display ID. The editor jumps to the entry's title line.                                                    |
   | 6  | References          | Shift-F12 on a display ID. The references panel lists every referencing entry.                                      |
   | 7  | Rename              | F2 on a display ID. Type a new ID and confirm. Every whole-token occurrence across every open project file updates. |
   | 8  | Document symbols    | Open the outline view. One symbol per entry, named by display ID.                                                   |
   | 9  | Workspace symbols   | Ctrl-T → type part of a display ID. Matching entries appear.                                                        |
   | 10 | Folding             | The gutter shows one foldable region per entry.                                                                     |
   | 11 | Document highlights | Click a display ID. Every occurrence in the file highlights (write at the declaration, read elsewhere).             |
   | 12 | Code action         | Trigger a diagnostic with a known quick-fix (e.g. uppercase `SHALL`). The light bulb offers the fix.                |
   | 13 | MCP                 | Open the MCP panel. The `markspec` server starts and exposes its tools.                                             |

5. **CRLF safety check (STK-WIN-0004).** Open a file saved with CRLF line
   endings (status bar bottom-right says `CRLF`). Edit the file, save, and
   confirm that:
   - the file's line endings remain CRLF after save,
   - no diagnostic locations point past the visible end of any line (which would
     indicate stray `\r` propagation), and
   - `markspec format` (Ctrl-Shift-P → Format Document) keeps the file as CRLF.

6. **Path-handling check (STK-WIN-0002).** Open a file with a path that contains
   spaces or non-ASCII characters (e.g. `C:\Users\dev\my project\café.md`).
   Diagnostics, go-to-definition, and references must work — no `file://C:\…`
   URI errors in the LSP output channel (View → Output → MarkSpec).

7. **Record the result.** File any failures as issues with the `os:windows`
   label; otherwise note "Windows smoke-test pass" in the release PR
   description.

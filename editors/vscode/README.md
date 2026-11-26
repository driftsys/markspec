# MarkSpec for VS Code

Author traceable requirements, specifications, and tests in Markdown — with live
validation, traceability navigation, and AI assistance built in.

MarkSpec is a Markdown flavor and toolchain for **traceable industrial
documentation**. You write requirements, architecture, and tests as ordinary
Markdown entry blocks; MarkSpec stamps each with a stable ID, links them with
trace relations (`Satisfies:`, `Verifies:`, `Derived-from:`, …), and validates
the whole graph. It targets ISO 26262 and ASPICE compliance workflows — but
works for any project that needs requirements that stay connected to their tests
and do not go out of date.

This extension brings the MarkSpec language server into VS Code, so the
traceability graph is live as you type.

> **No separate install required.** The extension bundles the version-matched
> `markspec` binary for your platform and runs it for you.

## A MarkSpec entry block

```markdown
- [SRS_BRK_0001] Sensor debouncing

  The sensor driver shall debounce raw inputs over a 20 ms window.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: SYS_BRK_0012
      Labels: ASIL-B
```

The display ID `SRS_BRK_0001` is the human-readable handle; the `Id:` ULID is
stamped automatically. `Satisfies:` is a trace link — the extension validates,
navigates, and renames across all trace links. MarkSpec generates the inverse
`Verified-by:` link from a test's `Verifies:`; do not write it.

## What you get

**Live validation.** Broken references, missing or duplicate IDs, malformed
entries, attribute and type errors, and uppercase modal verbs (`SHALL` →
`shall`) surface as squiggles within about a second of typing — each carrying an
`MSL-…` diagnostic code. Many come with a one-click quick fix.

**Authoring without boilerplate.**

- Type `- [` on a list line to scaffold a complete entry block, pre-filled with
  a fresh ULID and the next display ID for each type your profile declares.
- Trace-attribute completion suggests only the IDs the active profile allows in
  that slot (e.g. `Satisfies:` on a software requirement offers system
  requirements).
- `Type:` and `Labels:` values complete from the active profile catalog.
- Quick-fix code actions for common diagnostics: lowercase a modal verb, remove
  a generated attribute, "did you mean…" type suggestions, deduplicate
  attributes, and more.

**Navigate the graph.**

- Hover any display ID for a rendered Markdown preview of the target entry.
- Go to definition (`F12`) and find all references (`Shift+F12`) across the
  whole project.
- Project-wide rename (`F2`) of a display ID, updating every whole-token
  occurrence in every file.
- Outline view and `Ctrl+T` workspace search by display ID or title.
- CodeLens and inlay hints showing dependents and the satisfies-chain inline.
- Folding, document highlights, and per-entry semantic-token coloring.

**Source code is part of the graph.** Entry blocks and trace links written in
doc comments — Rust, Kotlin, Java, C/C++, TypeScript, JavaScript, C# — are
indexed alongside Markdown. A unit test's `/// Satisfies: SRS_BRK_0001` links
straight to the requirement it verifies.

**Gherkin `.feature` files.** A `.feature` file with `# [ID]` headers is part of
the graph too, with the same validation and navigation. The extension colours
Gherkin keywords and the MarkSpec headers. If you use the official Cucumber
extension, set `"files.associations": {"*.feature": "cucumber"}` so that its
language server attaches; MarkSpec still receives the file. See the
[VS Code guide](https://driftsys.github.io/markspec/guide/editor-vscode.html).

**Readable entry blocks.** Each entry is marked with a colored left bar and
label pills (red-bordered when a label isn't in the profile catalog), with
themed admonitions for light, dark, and high-contrast color themes.

**AI integration.** The extension registers the MarkSpec **MCP server**, so
GitHub Copilot and other MCP-aware assistants can query your requirements and
traceability graph directly instead of grepping Markdown. An optional inline
completion provider feeds workspace entry context to the model for
requirement-aware suggestions. The server covers every MarkSpec project under
the first workspace folder.

## Requirements

The extension starts the language server when your workspace contains a
**`.markspec.yaml`** file (the project activator). In a MarkSpec project it
indexes your entries on open and reports the entry count in the status bar; in a
plain Markdown or source repository it starts no server and writes nothing to
disk. The grammars and the commands work in every workspace.

New to MarkSpec? The [documentation](https://driftsys.github.io/markspec/) walks
through setting up a project and choosing a profile.

## Configuration

| Setting                                         | Default                           | What it does                                                                                                                                   |
| ----------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `markspec.server.path`                          | _(bundled binary)_                | Path to the `markspec` binary. Empty uses the bundled, version-matched binary; `markspec` uses your `PATH`; an absolute path uses a dev build. |
| `markspec.mcp.enabled`                          | `true`                            | Register the MarkSpec MCP server with VS Code for Copilot and other MCP clients.                                                               |
| `markspec.inlineCompletion.enabled`             | `true`                            | Enable the MarkSpec requirement-aware inline completion provider.                                                                              |
| `markspec.inlineCompletion.maxWorkspaceEntries` | `200`                             | Maximum workspace entries packed into the AI prompt context.                                                                                   |
| `markspec.trace.server`                         | `off`                             | Trace LSP traffic (`messages` / `verbose`) for debugging.                                                                                      |
| `markspec.trace.logPath`                        | _(workspace `.markspec/lsp.log`)_ | Override the LSP event-log path.                                                                                                               |

`markspec.server.path` expands `${workspaceFolder}`, so the language server and
the MCP server can share a workspace-owned verified binary, for example
`${workspaceFolder}/tools/markspec/markspec`. With no folder open, such a path
is refused with an error instead of being started; the MCP registration shows
that error once, not on each query.

Because a workspace can set this path, an untrusted workspace (Restricted Mode)
runs with limited support: VS Code ignores the workspace values of
`markspec.server.path`, `markspec.server.args`, `markspec.mcp.args` and
`markspec.trace.logPath`, and the extension runs the bundled binary, so
diagnostics, hover and completion keep working.

The MCP server tracks only the files of its project. It honors the `.gitignore`
files of the project and of the outermost enclosing project, the
`.markspec.yaml` `exclude:` patterns and nested project boundaries, so an empty
discovery boundary (`exclude: ["**"]`) starts no background compilation of the
repository. A malformed `.markspec.yaml` is reported and the default discovery
applies, as in the language server.

## Commands

Both are available from the Command Palette (`Ctrl/Cmd+Shift+P`):

- **MarkSpec: Show Output** — open the MarkSpec output channel (empty outside a
  MarkSpec project, where no server runs).
- **MarkSpec: Install CLI to PATH** — make the bundled `markspec` binary
  available in your terminal.

## Beyond the editor

The bundled `markspec` CLI does more than the editor surfaces live — prose-style
linting (EARS, passive voice, INCOSE), PDF and static-site rendering, coverage
and traceability-matrix reports, and an upstream lockfile with external-sync
tracking. Run **MarkSpec: Install CLI to PATH**, then `markspec --help`.

## Learn more

- [Documentation](https://driftsys.github.io/markspec/)
- [Language specification](https://github.com/driftsys/markspec/blob/main/docs/spec/language/language.md)
- [Source, issues & discussions](https://github.com/driftsys/markspec)

## License

MIT — see [LICENSE](https://github.com/driftsys/markspec/blob/main/LICENSE).

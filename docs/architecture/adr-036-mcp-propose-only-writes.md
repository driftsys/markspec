# ADR-036 — MCP writes are proposals that a person accepts

Status: Accepted (2026-11-11)\
Amends: [ADR-023](adr-023-mcp-trigger-language.md) (the "MarkSpec MCP is
read-only" SKIP clause)\
Related: [ADR-035](adr-035-markdesk.md) (agents propose, the author accepts),
#63, #40

## Context

The MCP server exposes only read tools. ADR-023's trigger language tells agents
to skip the server when the user wants to create or insert a requirement:
"writes are CLI-only (`markspec fmt`, `markspec insert`)". An agent that wants
to add a requirement must therefore shell out to `markspec insert`, which today
writes a fixed placeholder body (#40), and then edit the file by hand.

Issue #63 asks for an MCP `requirement_insert` tool. A tool that writes files
directly would let an agent change the traceability record without a person
seeing the change first. MarkDesk (ADR-035) already solved the same problem for
its assistant column: the assistant proposes a change, the app shows a formatted
preview, and the author accepts it before anything is written.

## Decision

1. **The MCP server gets write tools, but they only propose.** A write tool
   computes the change and returns a preview of it. It never writes a file.

2. **The preview is the formatted result.** The tool runs the same pipeline as
   `markspec insert` followed by `markspec fmt`, so the preview shows the entry
   exactly as it would be stored, with its `Id:` stamped by the formatter. A
   proposal that fails the pipeline is returned as diagnostics, not as a
   preview.

3. **A person accepts the proposal; the agent does not.** Applying a proposal is
   outside the MCP server: the person applies it in their editor, in MarkDesk,
   or with the CLI. No MCP tool applies a proposal.

4. **#40 comes first.** `markspec insert` gains a body read from stdin, so the
   CLI, the MCP tool and MarkDesk share one write path.

5. **ADR-023 is amended.** When the #63 tool ships, the server instructions and
   the SKIP clause "writes are CLI-only" change to: the MCP server never writes
   files; to add a requirement, call the proposal tool and show its preview to
   the user. Until then the current read-only instructions stay correct.

## Consequences

- The MCP server stays safe to enable in any workspace: no tool call changes a
  file.
- Agents get a structured way to draft requirements instead of scaffolding with
  `markspec insert` and editing by hand.
- The MCP proposal and the MarkDesk proposal share the format-then-preview step,
  so a requirement looks the same whichever surface drafted it.
- The tool name, its input schema and the preview format are decided in the #63
  story, not here.

## Alternatives considered

- **Keep the MCP server read-only.** Rejected: agents keep writing entries by
  hand, outside the formatter, which is the failure the `insert → fmt → check`
  loop exists to prevent.
- **A write tool that writes the file directly.** Rejected: an agent could
  change the traceability record without review, and MCP clients differ in
  whether they ask the user before a tool call.
- **A write tool gated by a per-project setting.** Rejected for now: it adds
  configuration without removing the need for a person to see the change.

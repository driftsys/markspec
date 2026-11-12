# ADR-036 — MCP writes are proposals that a person accepts

Status: Accepted (2026-11-11), not yet implemented\
Amends: [ADR-023](adr-023-mcp-trigger-language.md) (its "writes are CLI-only"
guidance), once #63 ships\
Related: [ADR-035](adr-035-markdesk.md) (agents propose, the author accepts),
#63, #40

## Context

The MCP server exposes only read tools. ADR-023's trigger language, and the
server instructions in `packages/markspec/mcp/server.ts`, tell agents that the
server is read-only and that writes are CLI-only (`markspec fmt`,
`markspec insert`). An agent that wants to add a requirement must therefore run
`markspec insert`, which writes a fixed placeholder body (#40), and then edit
the file by hand.

Issue #63 asks for an MCP `requirement_insert` tool. A tool that writes files
directly would let an agent change the traceability record without a person
seeing the change first. MarkDesk (ADR-035) already uses a different model for
its assistant column: the assistant proposes a change to one existing entry
body, the app shows a formatted preview, and the author accepts it before
anything is written.

## Decision

This ADR records a decision. None of it is implemented yet; #40 and #63 carry
the implementation.

1. **The MCP server gets write tools, but they only propose.** A write tool
   computes the change and returns a preview of it. It never writes a file.

2. **The preview is formatted.** The preview shows the new entry as
   `markspec fmt` would store it. A proposal that fails formatting or validation
   is returned as diagnostics, not as a preview. How the display ID and `Id:` of
   a proposed entry are assigned, and whether the values in the preview are the
   ones that get written, is decided in the #63 story.

3. **A person accepts the proposal; the agent does not.** No MCP tool applies a
   proposal. Which surfaces can apply one (the editor, MarkDesk, the CLI) is
   decided in the #63 story; today MarkDesk applies only changes to one existing
   entry body and refuses a proposal that adds an entry.

4. **#40 comes first.** `markspec insert` gains a body read from stdin. The #63
   tool builds on that write path.

5. **ADR-023 is amended when #63 ships.** At that point the server instructions
   and ADR-023's guidance that the server is read-only and that writes are
   CLI-only (the SKIP clauses and the closing "Do NOT use this server to edit
   entries" line) change to: the MCP server never writes files; to add a
   requirement, call the proposal tool and show its preview to the user. Until
   then the current read-only guidance stays correct.

## Consequences

- The MCP server stays safe to enable in any workspace: no tool call changes a
  file.
- Agents get a structured way to draft requirements instead of scaffolding with
  `markspec insert` and editing by hand.
- The tool name, its input schema, the preview format and how a proposal is
  applied are decided in the #63 story, not here.

## Alternatives considered

- **Keep the MCP server read-only.** Rejected: agents keep writing entries by
  hand, outside the formatter, which is the failure the `insert → fmt → check`
  loop exists to prevent.
- **A write tool that writes the file directly.** Rejected: an agent could
  change the traceability record without a person seeing the change first.
- **A write tool gated by a per-project setting.** Rejected for now: it adds
  configuration without removing the need for a person to see the change.

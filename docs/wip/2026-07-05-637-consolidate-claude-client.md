# Spec: consolidate Claude client to `--claude` + drop app-config write (#637)

**Date:** 2026-07-05 · **Issue:** #637 · **Status:** in progress

## Problem

`markspec mcp install --client` accepts both `claude-code` and `claude-desktop`.
The split is unusual, and `claude-desktop` writes the desktop app's **private
state file**
(`~/Library/Application Support/Claude/claude_desktop_config.json`), which the
sanctioned-surfaces policy says a tool should not touch (no vendor CLI, no
documented user-edit contract, whole-file blast radius).

## Decisions (from brainstorming)

1. **Drop `claude-desktop` entirely** — remove the client + its
   `claudeDesktopDescriptor`; nothing writes `claude_desktop_config.json`.
2. **Rename `claude-code` → `claude`** (= Claude Code) across the **whole CLI**
   — both `mcp install` and `markspec init` (they share `claudeCodeDescriptor`),
   so the Claude client is named consistently. Pre-1.0 breaking `--client`
   change.

Internal symbol/file names (`claudeCodeDescriptor`,
`mcp_adapters_claude_code.ts`) keep their names — they accurately describe the
_Claude Code product_ adapter; only the CLI-facing id string becomes `claude`.

## Scope

**Sanctioned surfaces after this change:** `claude` → `.mcp.json` (workspace),
`copilot` → `.github/mcp.json` | `~/.copilot/mcp-config.json`, `opencode` →
`opencode.json`, `cursor` (print-only), `vscode` (extension self-registers). No
writer for any app-private-state file.

## Changes

- `cli/install/adapters.ts` — `McpClientId` / `MCP_CLIENT_IDS`: drop
  `claude-desktop`, rename `claude-code`→`claude`.
- `cli/install/mcp_adapters.ts` — remove `claudeDesktopDescriptor`.
- `cli/install/mcp_adapters_claude_code.ts` — `id: "claude"`; fix the "same as
  claude-desktop" comment; detect fake token → `claude`.
- `cli/install/mcp_orchestrator.ts` — drop the claude-desktop import, dispatch
  branch, and user-only guard; project-scoped set = `{claude, opencode}`;
  copilot stays dual-scope.
- `cli/commands/mcp_cmd.ts` — `--client` help lists
  `claude|copilot|cursor|opencode|vscode`.
- `cli/init/types.ts`, `cli/init/client_resolver.ts`, `cli/commands/init.ts` —
  `InitClientId`/`EnumType`/map `claude-code`→`claude`.

## Behaviour

- `mcp install --client claude --print` → `.mcp.json` JSON (unchanged shape).
- `mcp install --client claude-desktop` / `--client claude-code` → _unknown
  client_ error that lists the known clients (which include `claude`). The old
  names are too far for the Levenshtein `suggestId` to propose `claude`
  directly, so the known-list is the migration cue.
- `markspec init --client claude` → writes `.mcp.json`; `--client claude-code`
  rejected by the Cliffy `EnumType`.

## Tests / docs

Update e2e (`mcp_install_test`, `init_test`) + unit tests to the new id and drop
the claude-desktop cases. Update `docs/guide/cli.md`, `ai-agents.md`,
`README.md` (remove Claude Desktop write instructions; add a "configure Claude
Desktop by hand" note with the app-private-state rationale). `CHANGELOG.md`
entry for the pre-1.0 breaking `--client` rename.

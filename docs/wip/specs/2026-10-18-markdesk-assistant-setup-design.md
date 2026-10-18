# MarkDesk assistant setup — design

Story: #831 (epic #826). Follow-up: #837 (first prompt feature with propose and
accept).

## 1. Intent

MarkDesk prompt features will run on an AI assistant CLI that is already on the
author's machine. Before any prompt feature exists, the author must be able to
see which assistants are available, choose one, and get help installing one.
MarkDesk must stay fully usable without an assistant.

This story delivers detection, selection, a guided install, a "Test" action, and
the disabled/enabled state of the assistant column. It does not deliver a prompt
feature.

## 2. Goals, non-goals, anti-goals

Goals:

- Detect Claude Code, Codex, and GitHub Copilot, each as one of three states:
  `not installed`, `needs sign-in`, `ready`.
- Let the author select one assistant when at least one is installed; store the
  choice.
- Show an install guide (link, install commands, sign-in step) for each of the
  three.
- Let the author test the selected assistant with one short prompt.
- Show the assistant column as disabled with a pointer to setup when no
  assistant is selected.

Non-goals (this story):

- Any prompt feature, proposal view, accept/reject flow, or `markspec fmt` after
  an accept. These move to #837.
- Attaching the MarkSpec MCP server (`markspec mcp`) to the assistant. That is
  part of #837.
- Other assistants (opencode, Ollama, OpenCode Zen). Dropped; see ADR-035.
- The retired `gh copilot` extension. "GitHub Copilot" means the standalone
  `copilot` CLI (npm `@github/copilot`). The extension was retired in
  October 2025.

Anti-goals (a failure even if everything else works):

- MarkDesk installs an assistant, runs a sign-in, or opens a terminal without an
  explicit author action. MarkDesk never runs an install command at all; it only
  shows commands and links.
- Detection consumes the author's assistant quota or contacts a provider without
  an author action. Only "Test" sends a prompt.
- The UI can make the Rust side run an arbitrary program or arbitrary arguments.
- A setup screen blocks the author from opening their product.

## 3. Decisions made with the author

1. Scope split: the propose/accept criterion moved from #831 to #837.
2. `markspec fmt` after an accept is invisible to the author (recorded in #837).
3. First run does not block. The product opens immediately; detection runs in
   the background and its result appears as a card in the assistant column.
4. The author always makes the choice. When one or more assistants are ready,
   the card offers one "Use" button per ready assistant. Nothing is selected
   automatically.
5. A "Settings" item in the ▾ product menu opens a settings view with the full
   assistant panel.
6. A "Test" action exists on the selected assistant. It sends one short prompt
   and shows the reply.
7. Copilot sign-in (option A): detection never sends a prompt. Copilot shows
   `needs sign-in` until a Test succeeds or a Copilot token is set in the
   environment (see §5.3).
8. Platforms: macOS and Linux are tested in this story. The Windows code paths
   (§5.1) are written but not tested; Windows testing is #838.

## 4. User-facing behaviour

### 4.1 First launch

- The product opens as today (open folder or reopen last product).
- Detection runs in the background on every app launch.
- When no assistant is selected and the author has not dismissed the card, the
  assistant column shows the setup card:
  - One row per assistant: name, state, and the action for that state.
    - `ready`: a "Use" button.
    - `needs sign-in`: the sign-in step (the command to run, with a copy button)
      and a "Re-check" button. For Copilot the text says that sign-in is not
      confirmed and that "Test" confirms it; a "Use" button is also offered for
      an installed Copilot, because only a Test can confirm it (see §5.3).
    - `not installed`: an "Install…" link that opens the install guide for that
      assistant.
  - When no assistant is installed, the card leads with "No assistant found. Set
    one up" and opens the install guide.
  - A "Not now" control dismisses the card. The dismissal is stored.
- While detection runs, the card shows a neutral "Looking for assistants…" line.
  The rest of the app is not affected.

### 4.2 Assistant column states

- No assistant selected (card dismissed, or card not applicable): the column
  shows a disabled prompt box with the text "Set up an assistant to ask
  questions about this product" and a "Set up" link that opens the settings
  view.
- Assistant selected: the column shows the assistant name and state, and the
  prompt box. The prompt box has no prompt feature behind it yet (#837); it
  stays disabled with the text "Prompts arrive in a later release". This is the
  "enabled" state of the #831 criterion: the column shows the selected assistant
  and links to Test and Settings instead of the setup pointer. See §9, call 1.
- Assistant selected but not `ready` (at launch, or selected in that state from
  Settings): the column shows the state ("Claude Code needs sign-in") and a link
  to Settings.

### 4.3 Settings view

- Opened from the ▾ product menu ("Settings"). It replaces the three panes and
  has a "Back" control that restores them.
- Assistant panel: one row per assistant with state, version (when installed),
  and the actions from §4.1, plus:
  - a radio-style selection among installed assistants, and "None". Any
    installed assistant can be selected, including one in `needs sign-in` (the
    author may be about to sign in). "Selected but needs sign-in" is therefore a
    normal state, shown in the column as in §4.2. The first-run card stays
    narrower: it offers "Use" only for `ready` assistants and for an installed
    Copilot;
  - "Re-check" (runs detection for all three);
  - "Test" for the selected assistant.
- The install guide is a section of the settings view (one block per assistant),
  also reachable from the card.

### 4.4 Install guide

For each assistant: a one-line description, a link to the official install page
(opened in the system browser through the existing opener permission), the
install commands per OS as copyable text, the sign-in command as copyable text,
and a "Re-check" button. MarkDesk does not run any of these commands.

| Assistant      | Official page                              | Install (examples, copy only)                                                                                                                                                                 | Sign-in                                  |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Claude Code    | <https://code.claude.com/docs/en/setup>    | macOS/Linux: `curl -fsSL https://claude.ai/install.sh \| bash`; Windows: `irm https://claude.ai/install.ps1 \| iex`; `brew install --cask claude-code`; `winget install Anthropic.ClaudeCode` | `claude auth login`                      |
| Codex          | <https://learn.chatgpt.com/docs/codex/cli> | macOS/Linux: `curl -fsSL https://chatgpt.com/codex/install.sh \| sh`; `npm install -g @openai/codex`                                                                                          | `codex login`                            |
| GitHub Copilot | <https://github.com/github/copilot-cli>    | macOS/Linux: `curl -fsSL https://gh.io/copilot-install \| bash`; `brew install copilot-cli`; `winget install GitHub.Copilot`; `npm install -g @github/copilot`                                | run `copilot`, then the `/login` command |

The builder re-checks every command and link against the official pages during
implementation and keeps the table data in one module, so updating it is one
edit.

### 4.5 Test

- Sends the fixed prompt `Reply with the single word: ready` to the selected
  assistant with tools and file writes disabled, in an empty temporary working
  directory, with a 60 s timeout.
- Shows a spinner, then the reply (first 500 characters) or the error (exit code
  and the first lines of stderr). A timeout is shown as a timeout.
- The author can cancel a running Test.
- A successful Test of Copilot stores "Copilot confirmed" (§5.3).
- `TestResult` classifies a failure as `usage` (the CLI rejected the arguments,
  for example "unknown option", typically from an older CLI version), `timeout`,
  `cancelled`, or `failed` (anything else, including signed out). A `usage`
  failure shows "This version of {assistant} does not support the test command.
  Update it and try again." Only a `failed` result clears "Copilot confirmed";
  `usage`, `timeout`, and `cancelled` leave it unchanged.
- The Test process runs with stdin closed, so an interactive prompt (for example
  a folder-trust question) cannot wait for input. The builder checks each CLI
  for such prompts in a new directory and adds the documented flag to skip them
  when one exists.

## 5. Detection

### 5.1 Finding the binary

A Tauri app opened from the Dock, Finder, or Start menu does not inherit the
user's shell `PATH`. On the author's Mac, Claude Code and Copilot are in
`/opt/homebrew/bin` and Codex is in `~/.local/bin`.

The Rust side resolves each binary by searching, in order:

1. The process `PATH`.
2. Well-known install directories:
   - macOS: `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`,
     `~/.npm-global/bin`.
   - Linux: `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, `~/.npm-global/bin`.
   - Windows: `%USERPROFILE%\.local\bin`, `%APPDATA%\npm`,
     `%LOCALAPPDATA%\Microsoft\WinGet\Links`.

   On Windows the search accepts `.exe` and `.cmd` (npm installs `.cmd` shims).
3. Not found: `not installed`.

A found binary counts as installed only if `<bin> --version` exits 0 within 5 s.
Its first output line is the version shown in settings.

Resolving the login shell `PATH` (for example `$SHELL -lc 'echo $PATH'`) is not
used. See §8.

### 5.2 Sign-in checks

All checks run the resolved binary directly (no shell), with a 10 s timeout, and
never prompt. A timeout or an unexpected error gives `needs sign-in` with the
error kept as detail for settings.

| Assistant      | Check                | `ready` when                                                                                                                                                                                                 |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code    | `claude auth status` | exit 0 (documented: 0 signed in, 1 not)                                                                                                                                                                      |
| Codex          | `codex login status` | exit 0. Exit codes are not documented; the builder verifies the signed-out case with an empty `CODEX_HOME` and adjusts the rule (for example, match "Logged in") if exit codes do not distinguish the cases. |
| GitHub Copilot | no command (see 5.3) | a Copilot token is set, or the stored "Copilot confirmed" flag is true                                                                                                                                       |

### 5.3 Copilot

The `copilot` CLI has no documented status command and does not document where
`/login` stores its token. Detection therefore never runs Copilot beyond
`--version`.

- `ready` when `COPILOT_GITHUB_TOKEN` is set in the app's environment, or when
  the stored `copilotConfirmed` flag is true. `GH_TOKEN` and `GITHUB_TOKEN` are
  not counted: they are often set for `gh` or CI, not for Copilot, and would
  show a false `ready`. An app opened from the Dock or Finder rarely sees any of
  these variables, so `copilotConfirmed` is the normal path to `ready`.
- Otherwise `needs sign-in`, shown as "Sign-in not confirmed. Sign in, then
  press Test."
- Because detection cannot see a `/login` sign-in, an installed Copilot can be
  selected in the `needs sign-in` state. A successful Test then sets
  `copilotConfirmed`.

## 6. Architecture

### 6.1 Rust (`apps/markdesk/src-tauri`)

New module `assistants.rs`:

- A closed enum `AssistantId { ClaudeCode, Codex, Copilot }` with the binary
  name, the version arguments, the sign-in check arguments, and the Test
  arguments as constants. The UI passes only an `AssistantId`; it never passes a
  program, a path, arguments, or prompt text.
- Processes run with `std::process::Command` (the same approach as the sidecar),
  not tauri-plugin-shell, so no shell scope is added to the capability file.
  Each run has a timeout and kills the child on timeout or cancel.
- Test arguments (the builder verifies each flag against the installed version
  and the official reference):
  - Claude Code:
    `claude -p <prompt> --output-format text --tools ""
    --no-session-persistence --max-turns 1`
  - Codex:
    `codex exec --sandbox read-only --skip-git-repo-check --ephemeral
    <prompt>`
  - Copilot:
    `copilot -p <prompt> -s --no-ask-user --deny-tool shell
    --deny-tool write`

New Tauri commands, registered beside the existing ones:

- `detect_assistants() -> Vec<AssistantStatus>` — runs the three detections in
  parallel. `AssistantStatus { id, state, version?, detail? }`.
- `test_assistant(id) -> TestResult` — `{ ok, reply?, error?, timedOut }`.
  Updates `copilotConfirmed` for Copilot.
- `cancel_assistant_test()`.
- `get_assistant_settings() -> AssistantSettings` and
  `set_assistant_settings(...)` —
  `{ selected: AssistantId | null,
  cardDismissed: bool, copilotConfirmed: bool }`.

Persistence: tauri-plugin-store, a new store file `settings.json` in the
app-data dir, key `assistant`. It is read and written on the Rust side, like
`recents.json`. An unreadable value is moved to `assistant.corrupt` and defaults
are used, as recents does.

### 6.2 UI (`apps/markdesk/src`)

- `shell/bridge.ts`: add the commands above to `ShellBridge` (and the test
  fake).
- `assistant/`: `useAssistants` (detection state, selection, Test), `SetupCard`,
  `AssistantColumn` (the states in §4.2), `installGuide.ts` (the table in §4.4
  as data).
- `settings/SettingsView.tsx`: the panel in §4.3, with the install guide.
- `app/ProductMenu.tsx`: add a "Settings" item (`onSettings` prop).
- `App.tsx`: a `view: "product" | "settings"` state.

## 7. Documentation

- ADR-035 `SAD_DESK_0007`: replace "Claude Code and GitHub Copilot CLI" with
  "Claude Code, Codex, and GitHub Copilot (the standalone `copilot` CLI)", and
  "detected on PATH" with "detected on PATH and in the standard install
  directories". Run `markspec fmt` and `markspec check` on the file.
- ADR-035 "Assistant column" text (currently "present and empty; assistant setup
  is a later story"): describe the setup card, the disabled state, and Settings.
- `docs/product/markdesk.md`: update the assistant section with the same states.

## 8. Alternatives considered

- **Setup screen on first run (blocking, with Skip).** Rejected: the main path
  is opening a product; a wizard blocks it for an optional feature and is often
  skipped by reflex, which loses the choice.
- **Auto-select when exactly one assistant is ready.** Rejected: the issue says
  the author picks; a one-click "Use" keeps it quick.
- **Copilot detection with a real prompt (option B).** Rejected: uses the
  author's Copilot quota on every detection and contacts GitHub without an
  author action.
- **tauri-plugin-shell with a scoped capability.** Rejected: the existing
  sidecar already uses `std::process::Command`; a closed Rust enum is a smaller
  surface than a shell scope.
- **Login-shell `PATH` resolution.** Rejected for now: it starts the user's
  shell profile (slow, may print or prompt, differs per shell) and still misses
  Windows. Fixed install directories cover the documented installers. Revisit if
  authors report a missed install.
- **Building the propose/accept flow now.** Rejected: its shape depends on the
  first prompt feature; moved to #837.

## 9. Calls left to the builder (or made by the designer)

1. Designer's call: the "enabled" prompt placeholder stays a disabled input with
   "Prompts arrive in a later release", because no prompt feature exists. The
   #831 criterion is read as "the column switches from the setup pointer to the
   selected-assistant state".
2. Designer's call: detection runs on every launch, not only the first one, so
   the column can show a selected assistant that is no longer ready.
3. Designer's call: MarkDesk never opens a terminal for install or sign-in; it
   shows copyable commands and a link.
4. Builder: exact layout and styling of the card and settings view, following
   the existing `--md-*` tokens.
5. Builder: whether Settings is also reachable before a product is open (for
   example from the open-folder screen), if the ▾ menu is not shown there.
6. Builder: the exact signed-out rule for Codex after testing (§5.2).
7. Designer's call: only `COPILOT_GITHUB_TOKEN` counts as a Copilot sign-in
   signal (§5.3).
8. Designer's call: Test failures are classified; only a `failed` result clears
   "Copilot confirmed" (§4.5).
9. Designer's call: Settings can select any installed assistant, including one
   that needs sign-in; the first-run card offers "Use" only for `ready`
   assistants and an installed Copilot (§4.3).

## 10. Testing

- Rust: unit tests in `assistants.rs` with fake executables (shell scripts in a
  temp directory, as the sidecar tests do) for each exit-code path, the timeout,
  the install-directory search, and the store round trip including a corrupt
  value. CI runs them in the existing "Tauri shell" job (Linux). Windows-only
  code is compiled behind `cfg(windows)` and is not tested here (#838).
- UI: vitest tests with the fake bridge for each column state, the card (none /
  one / several ready, dismiss), the settings selection, Test success / error /
  timeout / cancel, and the "Settings" menu item.
- Manual, before merge: on macOS with all three installed and signed in; with
  `CODEX_HOME` and `CLAUDE_CONFIG_DIR` pointed at empty temp dirs (signed out);
  launched from Finder (not from a terminal) to confirm the install-directory
  search.

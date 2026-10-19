# MarkDesk Assistant Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** MarkDesk detects Claude Code, Codex, and GitHub Copilot, lets the
author select and test one, shows an install guide, and switches the assistant
column between a setup pointer and the selected-assistant state.

**Architecture:** A new Rust module (`assistants.rs`) locates the three CLIs,
runs fixed argument lists with timeouts, and classifies results; a second module
(`assistant_settings.rs`) parses the stored choice. Five Tauri commands expose
them. On the UI side, an `AssistantProvider` holds detection, settings, and Test
state; the assistant column, a first-run card, and a new settings view read from
it.

**Tech Stack:** Rust (Tauri v2, tauri-plugin-store, `std::process::Command`),
React + TypeScript (vitest, @testing-library/react).

**Spec:** `docs/wip/specs/2026-10-18-markdesk-assistant-setup-design.md`

All paths below are relative to `apps/markdesk/` unless they start with `docs/`.

## Global Constraints

- No new crates and no new npm packages. Cargo dependencies stay pinned with
  `=`. No `tempfile`, no `which`, no `tauri-plugin-shell`.
- `capabilities/default.json` does not change. Custom commands need no entry.
- The UI passes only an `AssistantId` to Rust. No program, path, argument, or
  prompt text crosses the bridge.
- Processes run the resolved binary directly (no shell), with stdin closed
  (`Stdio::null()`), stdout and stderr piped and drained on threads.
- Timeouts: `--version` 5 s; sign-in check 10 s; Test 60 s.
- Test prompt, exact: `Reply with the single word: ready`.
- Test reply shown: first 500 characters. Test error shown: exit code plus the
  first 5 lines of stderr.
- Store file `settings.json`, key `assistant`, corrupt key `assistant.corrupt`.
- Only `COPILOT_GITHUB_TOKEN` (non-empty) counts as a Copilot sign-in signal.
- MarkDesk never runs an install or sign-in command and never opens a terminal.
- macOS and Linux are tested. Windows-only code sits behind `cfg(windows)` and
  is not tested in this story (#838).
- UI copy is plain English and matches the strings in this plan exactly.

## Review Focus

1. A CLI on the search path that hangs on `--version` (for example, waits for
   input): detection must finish within the version timeout and report
   `not-installed` with a detail, not hang. Test: Task 1,
   `detect_reports_not_installed_when_version_hangs`.
2. A CLI that prints megabytes during Test: no pipe deadlock, reply truncated to
   500 characters. Test: Task 2, `run_test_truncates_large_reply`.
3. Non-UTF-8 bytes in CLI output: converted lossily, never a panic. Test: Task
   1, `run_output_is_lossy_utf8`.
4. A stored setting from a newer MarkDesk (unknown assistant id): handled like
   any unreadable value, defaults used, original kept under `assistant.corrupt`.
   Test: Task 3, `unknown_assistant_id_is_corrupt`.
5. A search-path entry named like the CLI that is a directory or is not
   executable: skipped, the next candidate is used. Test: Task 1,
   `locate_skips_directories_and_non_executables`.

---

### Task 1: Locate and detect the assistant CLIs (Rust)

**Files:**

- Create: `src-tauri/src/assistants.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod assistants;` only)

**Interfaces:**

- Produces (all `pub` in `assistants.rs`):
  - `enum AssistantId { ClaudeCode, Codex, Copilot }` — derives
    `Clone, Copy,
    Debug, PartialEq, Eq, Serialize, Deserialize`,
    `#[serde(rename_all =
    "kebab-case")]` (`"claude-code"`, `"codex"`,
    `"copilot"`). `const ALL: [AssistantId; 3]`;
    `fn binary(self) -> &'static str` (`claude`, `codex`, `copilot`).
  - `enum AssistantState { NotInstalled, NeedsSignIn, Ready }` — serde
    kebab-case.
  - `struct AssistantStatus { id: AssistantId, state: AssistantState, version:
    Option<String>, detail: Option<String> }`
    — `Serialize`, camelCase.
  - `struct RunOutput { code: Option<i32>, stdout: String, stderr: String,
    timed_out: bool, cancelled: bool }`
  - `fn run(program: &Path, args: &[String], cwd: Option<&Path>, timeout:
    Duration, cancel: Option<&AtomicBool>) -> std::io::Result<RunOutput>`
  - `fn locate(binary: &str, path_env: Option<&OsStr>, extra_dirs: &[PathBuf])
    -> Option<PathBuf>`
  - `fn default_search_dirs(home: &Path) -> Vec<PathBuf>`
  - `struct Probe { path_env: Option<OsString>, extra_dirs: Vec<PathBuf>,
    copilot_token: bool, copilot_confirmed: bool, version_timeout: Duration,
    status_timeout: Duration }`
    with `fn new(home: &Path, copilot_confirmed:
    bool) -> Probe` reading
    `PATH` and `COPILOT_GITHUB_TOKEN` and the constants `VERSION_TIMEOUT` (5 s)
    and `STATUS_TIMEOUT` (10 s).
  - `fn detect(id: AssistantId, probe: &Probe) -> AssistantStatus`
  - `fn detect_all(probe: &Probe) -> Vec<AssistantStatus>` (three threads,
    result in `ALL` order).

- [ ] **Step 1: Write the failing tests** in
      `#[cfg(all(test, unix))] mod
      tests` at the bottom of
      `assistants.rs`. Add a test helper
      `fake_bin(dir: &Path, name: &str, script: &str) -> PathBuf` that writes
      `#!/bin/sh\n{script}` and sets mode `0o755`, and
      `scratch_dir(label:
      &str) -> PathBuf` that creates a unique
      directory under `std::env::temp_dir()` (process id + label + counter).
      Tests:

```rust
#[test] fn locate_finds_binary_in_extra_dir()          // PATH empty, extra dir has `claude` → Some(that path)
#[test] fn locate_prefers_path_env_over_extra_dirs()   // both have `codex` → the PATH one
#[test] fn locate_skips_directories_and_non_executables() // dir1/claude is a dir, dir2/claude mode 0o644, dir3/claude ok → dir3
#[test] fn locate_returns_none_when_missing()
#[test] fn run_output_is_lossy_utf8()                  // script: printf '\377ok' → stdout ends with "ok", no panic
#[test] fn run_kills_child_on_timeout()                // script: sleep 30, timeout 200 ms → timed_out == true, returns < 2 s
#[test] fn run_stops_when_cancelled()                  // cancel flag set before run → cancelled == true
#[test] fn detect_reports_not_installed_when_missing()
#[test] fn detect_reports_not_installed_when_version_hangs() // `--version` sleeps; version_timeout 200 ms → NotInstalled, detail Some(..)
#[test] fn detect_claude_ready_on_auth_status_zero()   // fake: case "$1" in --version) echo "2.1.292 (Claude Code)";; auth) exit 0;; esac → Ready, version Some("2.1.292 (Claude Code)")
#[test] fn detect_claude_needs_sign_in_on_auth_status_one()
#[test] fn detect_codex_ready_on_login_status_zero()
#[test] fn detect_codex_needs_sign_in_on_login_status_nonzero()
#[test] fn detect_codex_needs_sign_in_on_status_timeout() // status sleeps; status_timeout 200 ms → NeedsSignIn, detail Some(..)
#[test] fn detect_copilot_needs_sign_in_by_default()   // fake records its args to a file; assert only `--version` was ever called
#[test] fn detect_copilot_ready_with_token()
#[test] fn detect_copilot_ready_when_confirmed()
#[test] fn detect_all_returns_three_in_fixed_order()
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --locked assistants` Expected: compile errors
(module items not defined).

- [ ] **Step 3: Implement the items listed under Interfaces.**
  - `run`: spawn with `Stdio::null()` stdin and piped stdout/stderr; one reader
    thread per pipe collecting bytes; poll `try_wait` every 20 ms until exit,
    the deadline, or `cancel` is set; on deadline or cancel, kill and wait.
    Convert with `String::from_utf8_lossy`. On Windows set `CREATE_NO_WINDOW` as
    `sidecar.rs` does.
  - `locate`: candidates are each entry of `path_env` (split with
    `std::env::split_paths`), then `extra_dirs`; a candidate is accepted when it
    is a file with any execute bit set (unix). Under `cfg(windows)` try
    `{binary}.exe` then `{binary}.cmd` and accept any existing file.
  - `default_search_dirs` per OS, exactly as spec §5.1 (`~` = `home`). On
    Windows read `APPDATA` / `LOCALAPPDATA` from the environment.
  - `detect`: `locate` → none gives `NotInstalled`. Run `--version`; a non-zero
    exit, error, or timeout gives `NotInstalled` with the reason in `detail`;
    otherwise `version` = first trimmed stdout line. Then: Claude Code runs
    `auth status`, Codex runs `login status`; exit 0 → `Ready`, anything else
    (including timeout) → `NeedsSignIn` with a `detail` when it was an error or
    timeout. Copilot → `Ready` if `copilot_token ||
    copilot_confirmed`, else
    `NeedsSignIn`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
`cd src-tauri && cargo test --locked assistants && cargo clippy
--all-targets --locked -- -D warnings && cargo fmt --check`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/assistants.rs src-tauri/src/lib.rs
git commit -m "feat(repo): detect MarkDesk assistant CLIs"
```

---

### Task 2: Run the assistant Test (Rust)

**Files:**

- Modify: `src-tauri/src/assistants.rs`

**Interfaces:**

- Consumes: `AssistantId`, `run`, `RunOutput` (Task 1).
- Produces:
  - `const TEST_PROMPT: &str = "Reply with the single word: ready";`
  - `const TEST_TIMEOUT: Duration` (60 s)
  - `enum TestOutcome { Ok, Usage, Timeout, Cancelled, Failed }` — serde
    kebab-case.
  - `struct TestResult { outcome: TestOutcome, reply: Option<String>, error:
    Option<String> }`
    — `Serialize`, camelCase.
  - `impl AssistantId { fn test_args(self) -> Vec<String> }`
  - `fn classify(output: &RunOutput) -> TestOutcome`
  - `fn run_test(id: AssistantId, program: &Path, timeout: Duration, cancel:
    &AtomicBool) -> TestResult`

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn test_args_are_fixed() {
    assert_eq!(AssistantId::ClaudeCode.test_args(), ["-p", TEST_PROMPT, "--output-format", "text", "--tools", "", "--no-session-persistence", "--max-turns", "1"]);
    assert_eq!(AssistantId::Codex.test_args(), ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", TEST_PROMPT]);
    assert_eq!(AssistantId::Copilot.test_args(), ["-p", TEST_PROMPT, "-s", "--no-ask-user", "--deny-tool", "shell", "--deny-tool", "write"]);
}
#[test] fn classify_ok_on_exit_zero()
#[test] fn classify_usage_on_unknown_option()      // code 1, stderr "error: unknown option '--tools'" → Usage
#[test] fn classify_usage_on_unexpected_argument() // code 2, stderr "error: unexpected argument '--ephemeral' found" → Usage
#[test] fn classify_timeout_and_cancelled_win_over_exit_code()
#[test] fn classify_failed_otherwise()            // code 1, stderr "Not logged in" → Failed
#[test] fn run_test_returns_reply()               // fake echoes "ready" → Ok, reply Some("ready")
#[test] fn run_test_truncates_large_reply()       // fake: yes x | head -c 2000000 → Ok, reply.chars().count() == 500
#[test] fn run_test_reports_exit_code_and_first_stderr_lines() // 8 stderr lines, exit 3 → Failed, error contains "exit code 3", contains line 5, not line 6
#[test] fn run_test_runs_in_empty_temp_dir()      // fake: pwd; ls -A | wc -l → reply shows a path under temp_dir and "0"; dir removed afterwards
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --locked assistants` Expected: compile errors
for the new items.

- [ ] **Step 3: Implement.**
  - `classify` order: `cancelled` → `Cancelled`; `timed_out` → `Timeout`; code 0
    → `Ok`; stderr (lowercased) contains any of `unknown option`,
    `unexpected argument`, `unrecognized option`, `unrecognized argument`,
    `unknown argument` → `Usage`; else `Failed`.
  - `run_test`: create a fresh directory under `std::env::temp_dir()`, call
    `run` with `test_args()`, `cwd` = that directory, remove it afterwards. `Ok`
    → `reply` = trimmed stdout cut to 500 characters. `Failed` and `Usage` →
    `error` = `exit code {code}` plus the first 5 stderr lines. A spawn error →
    `Failed` with the error text.
  - Before writing `test_args`, check each flag against the installed CLI
    (`claude --help`, `codex exec --help`, `copilot --help`) and the official
    references. If a flag is missing or renamed, use the documented one and note
    the change in the commit message. Check whether `copilot -p` asks a
    folder-trust question in a new directory; if a documented flag skips it, add
    it.

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
`cd src-tauri && cargo test --locked assistants && cargo clippy
--all-targets --locked -- -D warnings`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/assistants.rs
git commit -m "feat(repo): run a short test prompt on a MarkDesk assistant"
```

---

### Task 3: Store the choice and expose the Tauri commands

**Files:**

- Create: `src-tauri/src/assistant_settings.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**

- Consumes: everything in Tasks 1–2.
- Produces:
  - `assistant_settings.rs`:
    `struct AssistantSettings { selected:
    Option<AssistantId>, card_dismissed: bool, copilot_confirmed: bool }`
    — `Serialize, Deserialize, Default, Clone, Debug, PartialEq`, camelCase,
    `#[serde(deny_unknown_fields)]` not used.
    `struct ParsedSettings {
    settings: AssistantSettings, corrupt: Option<serde_json::Value> }`.
    `fn
    parse_stored(value: Option<serde_json::Value>) -> ParsedSettings`
    (mirrors `recents::parse_stored`).
  - `lib.rs` constants `SETTINGS_STORE = "settings.json"`,
    `ASSISTANT_KEY =
    "assistant"`,
    `ASSISTANT_CORRUPT_KEY = "assistant.corrupt"`, helpers
    `load_assistant_settings(app: &AppHandle) -> Result<AssistantSettings,
    String>`
    and
    `save_assistant_settings(app: &AppHandle, s:
    &AssistantSettings) -> Result<(), String>`
    following `load_recents`/`save_recents`.
  - Managed state `AssistantTestCancel(Arc<AtomicBool>)`.
  - Commands (add to `generate_handler!`):
    - `async fn detect_assistants(app: AppHandle) ->
      Result<Vec<AssistantStatus>, String>`
      — `spawn_blocking`; home from `app.path().home_dir()`; `copilot_confirmed`
      from stored settings.
    - `async fn test_assistant(app: AppHandle, id: AssistantId) ->
      Result<TestResult, String>`
      — resets the cancel flag, locates the binary with `Probe::new`; not found
      →
      `TestResult { outcome: Failed,
      error: Some("{binary} is not installed") }`.
      For Copilot: `Ok` stores `copilot_confirmed = true`; `Failed` stores
      `false`; other outcomes leave it.
    - `fn cancel_assistant_test(app: AppHandle)` — sets the flag.
    - `fn get_assistant_settings(app: AppHandle) ->
      Result<AssistantSettings, String>`
    - `fn set_assistant_settings(app: AppHandle, settings:
      AssistantSettings) -> Result<(), String>`

- [ ] **Step 1: Write the failing tests** in `assistant_settings.rs`:

```rust
#[test] fn missing_value_gives_defaults()           // None → default, corrupt None
#[test] fn round_trips_all_fields()                 // json!({"selected":"codex","cardDismissed":true,"copilotConfirmed":true})
#[test] fn null_selected_is_none()
#[test] fn unknown_assistant_id_is_corrupt()        // {"selected":"gemini"} → default, corrupt Some(original)
#[test] fn wrong_type_is_corrupt()                  // json!("text") → default, corrupt Some
#[test] fn missing_fields_default()                 // json!({"selected":"copilot"}) → card_dismissed false, copilot_confirmed false, corrupt None
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --locked assistant_settings` Expected: compile
errors.

- [ ] **Step 3: Implement** `assistant_settings.rs` (`#[serde(default)]` on the
      struct) and the `lib.rs` constants, helpers, managed state, and five
      commands. The corrupt handling copies `load_recents` (keep the original
      under `assistant.corrupt` only when that key is empty, delete the main
      key, save, ignore the write error).

- [ ] **Step 4: Run all Rust checks**

Run:
`cd src-tauri && cargo test --locked && cargo clippy --all-targets
--locked -- -D warnings && cargo fmt --check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/assistant_settings.rs src-tauri/src/lib.rs
git commit -m "feat(repo): store the MarkDesk assistant choice and add commands"
```

---

### Task 4: Bridge methods and the assistant state provider (UI)

**Files:**

- Modify: `src/shell/bridge.ts`
- Modify: `src/app/App.test.tsx` (`fakeBridge`),
  `src/document/DocumentPane.test.tsx` (its bridge fake, if it builds a full
  `ShellBridge`)
- Create: `src/assistant/AssistantProvider.tsx`
- Create: `src/assistant/testBridge.ts` (shared fake:
  `fakeAssistantBridge(overrides?: Partial<ShellBridge>): Pick<ShellBridge, assistant methods>`)
- Test: `src/assistant/AssistantProvider.test.tsx`

**Interfaces:**

- Consumes: the five commands from Task 3 (snake_case names, camelCase
  payloads).
- Produces:
  - In `bridge.ts`:

    ```ts
    export type AssistantId = "claude-code" | "codex" | "copilot";
    export type AssistantState = "not-installed" | "needs-sign-in" | "ready";
    export interface AssistantStatus { id: AssistantId; state: AssistantState; version: string | null; detail: string | null; }
    export type TestOutcome = "ok" | "usage" | "timeout" | "cancelled" | "failed";
    export interface AssistantTestResult { outcome: TestOutcome; reply: string | null; error: string | null; }
    export interface AssistantSettings { selected: AssistantId | null; cardDismissed: boolean; copilotConfirmed: boolean; }
    // ShellBridge additions:
    detectAssistants(): Promise<AssistantStatus[]>;
    testAssistant(id: AssistantId): Promise<AssistantTestResult>;
    cancelAssistantTest(): Promise<void>;
    getAssistantSettings(): Promise<AssistantSettings>;
    setAssistantSettings(settings: AssistantSettings): Promise<void>;
    ```

  - In `AssistantProvider.tsx`:
    `AssistantProvider(props: { children:
    ReactNode })` (reads the bridge
    from `BridgeContext`) and `useAssistants():
    AssistantController` where

    ```ts
    interface AssistantController {
      statuses: AssistantStatus[] | undefined; // undefined until the first detection returns
      detecting: boolean;
      settings: AssistantSettings | undefined;
      test: { running: boolean; result: AssistantTestResult | undefined };
      recheck(): Promise<void>;
      select(id: AssistantId | null): Promise<void>;
      dismissCard(): Promise<void>;
      runTest(): Promise<void>; // tests settings.selected; no-op when null or running
      cancelTest(): Promise<void>;
    }
    ```

- [ ] **Step 1: Write the failing tests** (`AssistantProvider.test.tsx`, render
      a probe component inside `BridgeContext.Provider` + `AssistantProvider`):

```ts
it("detects and loads settings on mount")           // detectAssistants and getAssistantSettings each called once; statuses/settings exposed
it("reports detecting until detection returns")
it("select stores the choice")                      // setAssistantSettings called with {...settings, selected: "codex"}
it("dismissCard stores cardDismissed")
it("runTest calls testAssistant with the selected id and exposes the result")
it("runTest is a no-op while a test is running")     // two calls → testAssistant called once
it("runTest re-reads settings and re-detects after a Copilot test") // getAssistantSettings ×2, detectAssistants ×2
it("cancelTest calls cancelAssistantTest")
it("recheck runs detection again")
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/assistant/AssistantProvider.test.tsx` Expected: FAIL
(module not found).

- [ ] **Step 3: Implement** the bridge types and `tauriBridge` entries
      (`invoke("detect_assistants")`, `invoke("test_assistant", { id })`,
      `invoke("cancel_assistant_test")`, `invoke("get_assistant_settings")`,
      `invoke("set_assistant_settings", { settings })`), the provider, the
      shared fake, and the additions to the existing bridge fakes (spread
      `fakeAssistantBridge()` into them).

- [ ] **Step 4: Run the UI checks**

Run: `npm run typecheck && npm test` Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/shell/bridge.ts src/assistant src/app/App.test.tsx src/document/DocumentPane.test.tsx
git commit -m "feat(repo): add the MarkDesk assistant bridge and state provider"
```

---

### Task 5: Settings view, install guide, and the Settings menu item (UI)

**Files:**

- Create: `src/assistant/catalog.ts`
- Create: `src/settings/SettingsView.tsx`, `src/settings/SettingsView.test.tsx`
- Modify: `src/app/ProductMenu.tsx`, `src/app/ProductMenu.test.tsx`
- Modify: `src/app/App.tsx`, `src/app/App.test.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**

- Consumes: `useAssistants()`, `AssistantProvider` (Task 4);
  `ShellBridge.openExternal`.
- Produces:
  - `catalog.ts`: `ASSISTANTS: readonly AssistantInfo[]` in the order Claude
    Code, Codex, GitHub Copilot, where
    `interface AssistantInfo { id:
    AssistantId; name: string; description: string; installPage: string;
    installCommands: readonly { label: string; command: string }[];
    signInCommand: string; signInNote?: string }`,
    and `assistantName(id):
    string`. Values: the table in spec §4.4 (names
    `Claude Code`, `Codex`, `GitHub Copilot`; Copilot
    `signInCommand: "copilot"`, `signInNote: "Then
    type /login."`).
  - `SettingsView(props: { onBack(): void; focus?: "install" })`.
  - `ProductMenu` new prop `onSettings(): void`; new last item `Settings`.
    Settings is reachable only from an open product (the start screen has no
    menu); this settles spec §9 call 5.
  - `App`: `view: "product" | "settings"` state plus `settingsFocus`; exposes
    `openSettings(focus?: "install")` to the column in Task 6 via the prop
    `onOpenSettings` on `AssistantColumn`.

- [ ] **Step 1: Write the failing tests**

`SettingsView.test.tsx` (fake bridge with three statuses: Claude Code `ready`
version `2.1.292 (Claude Code)`, Codex `needs-sign-in`, Copilot
`not-installed`):

```ts
it("lists the three assistants with their state")    // "Ready", "Needs sign-in", "Not installed"; version text shown
it("shows the Copilot sign-in note when Copilot needs sign-in") // "Sign-in not confirmed. Sign in, then press Test."
it("offers a radio per installed assistant plus None") // radios: Claude Code, Codex, None; none for Copilot
it("selecting a radio stores the choice")
it("Re-check runs detection again")
it("Test is disabled when no assistant is selected")
it("Test shows Testing… and Cancel, then the reply")   // reply "ready" → text "Reply: ready"
it("Test shows the usage message")                     // "This version of Claude Code does not support the test command. Update it and try again."
it("Test shows the timeout message")                   // "Claude Code did not answer within 60 seconds."
it("Test shows the failure with its error")            // "Test failed: exit code 1 …"
it("Back calls onBack")
it("install guide shows each assistant's commands, page link, and sign-in step") // link click → openExternal("https://code.claude.com/docs/en/setup")
it("Copy writes the command to the clipboard")         // navigator.clipboard.writeText mocked
```

`ProductMenu.test.tsx`: `it("Settings calls onSettings and closes the menu")`.

`App.test.tsx`: `it("opens Settings from the menu and returns with Back")`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/settings src/app` Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `App.tsx`: wrap the product view in `<AssistantProvider>` (inside
    `BridgeContext.Provider`, keyed by `product.root`). When
    `view ===
    "settings"`, render the header (`ProductMenu`) and
    `<SettingsView>` in place of the three panes; otherwise the existing
    `Workspace`.
  - `SettingsView`: heading `Settings`, button `Back`, section `Assistant`
    (rows, radio group named `assistant`, buttons `Re-check`, `Test`, and
    `Cancel` while running), section `Install an assistant` with
    `id=
    "install-guide"`. When `focus === "install"`, call
    `scrollIntoView?.()` on that section after mount.
  - Copy strings, exact: state labels `Ready`, `Needs sign-in`,
    `Not
    installed`; `Testing…`; `Reply: {reply}`; `Test cancelled.`;
    `Test failed:
    {error}`; usage and timeout messages as in the tests; link
    text `Official
    install page`; button `Copy`.
  - Styles in `app.css` under a `/* ── Settings ──── */` block, using existing
    `--md-*` tokens only.

- [ ] **Step 4: Run the UI checks**

Run: `npm run typecheck && npm test && npm run build` Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(repo): add MarkDesk settings with assistant panel and install guide"
```

---

### Task 6: Assistant column states, first-run card, and docs

**Files:**

- Modify: `src/assistant/AssistantColumn.tsx`,
  `src/assistant/AssistantColumn.test.tsx`
- Create: `src/assistant/SetupCard.tsx`, `src/assistant/SetupCard.test.tsx`
- Modify: `src/app/App.tsx` (pass `onOpenSettings`), `src/styles/app.css`
- Modify: `docs/architecture/adr-035-markdesk.md`, `docs/product/markdesk.md`

**Interfaces:**

- Consumes: `useAssistants()` (Task 4), `assistantName` (Task 5), `openSettings`
  from `App` (Task 5).
- Produces:
  `AssistantColumn(props: { onOpenSettings(focus?: "install"):
  void })`;
  `SetupCard(props: { onOpenSettings(focus?: "install"): void })`.

- [ ] **Step 1: Write the failing tests**

`SetupCard.test.tsx`:

```ts
it("shows Looking for assistants… while detecting")
it("offers Use for each ready assistant")             // Claude Code and Codex ready → two "Use" buttons; click → select("codex")
it("offers Use for an installed Copilot that needs sign-in")
it("shows the sign-in command and Re-check for a signed-out Claude Code or Codex") // no Use button for that row
it("links Install… to the install guide")              // click → onOpenSettings("install")
it("leads with No assistant found when none is installed") // text "No assistant found. Set one up"; button opens onOpenSettings("install")
it("Not now dismisses the card")                       // dismissCard called
```

`AssistantColumn.test.tsx` (replace the existing test):

```ts
it("shows the setup card when nothing is selected and the card is not dismissed")
it("shows the setup pointer when nothing is selected and the card is dismissed") // text "Set up an assistant to ask questions about this product.", disabled textbox, button "Set up" → onOpenSettings()
it("shows the selected assistant when it is ready") // "Claude Code · Ready", disabled textbox with placeholder "Prompts arrive in a later release", button "Settings"
it("shows the state when the selected assistant needs sign-in") // "Claude Code needs sign-in", button "Settings"
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- src/assistant` Expected: FAIL.

- [ ] **Step 3: Implement** the two components, pass `onOpenSettings` from
      `App`, add styles. Then update the docs:
  - ADR-035 `SAD_DESK_0007`: replace "Claude Code and GitHub Copilot CLI" with
    "Claude Code, Codex, and GitHub Copilot (the standalone `copilot` CLI)", and
    "detected on PATH" with "detected on PATH and in the standard install
    directories".
  - ADR-035 "Assistant column" text: describe the setup card, the setup pointer,
    the selected-assistant state, and Settings. Add one sentence: prompt
    features and the propose/accept flow arrive with #837.
  - `docs/product/markdesk.md` assistant section: same states, Test, and that
    MarkDesk never installs or signs in on its own.
  - Run `deno run -A packages/markspec/main.ts fmt <both files>` and
    `... check
    <both files>` from the repository root; both must be clean.

- [ ] **Step 4: Run every check**

Run:
`npm run typecheck && npm test && npm run build && bash
../../scripts/check_desk_client.sh`
(from `apps/markdesk`), then
`cd src-tauri
&& cargo test --locked && cargo clippy --all-targets --locked -- -D warnings`,
then `just build` from the repository root. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src docs/architecture/adr-035-markdesk.md docs/product/markdesk.md
git commit -m "feat(repo): show MarkDesk assistant setup in the assistant column"
```

---

## Manual verification before the pull request

Run on macOS with `npm run tauri dev` and with a release build opened from
Finder:

1. All three CLIs installed and signed in: Claude Code and Codex show `Ready`;
   Copilot shows `Sign-in not confirmed`; selecting Copilot and pressing Test
   turns it `Ready`.
2. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointed at empty temporary directories
   (dev run): both show `Needs sign-in`. Record what `codex login status` prints
   and its exit code when signed out, and adjust the Codex rule (spec §5.2) if
   the exit code does not distinguish the cases.
3. Opened from Finder: detection still finds the CLIs in `/opt/homebrew/bin` and
   `~/.local/bin`.

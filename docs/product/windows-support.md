# Windows support — stakeholder requirements

Tracks: [#403](https://github.com/driftsys/markspec/issues/403)

## Purpose

Define what "Windows support" means for MarkSpec across the CLI binary, the
VSCode extension, and the installation experience. Windows is currently a
declared but unverified target — `deno compile` emits `markspec.exe` and the
VSCode extension ships a `win32-x64` VSIX, but no Windows runner has ever
executed the test suite and several path-handling bugs prevent the LSP from
functioning correctly on a native Windows host. This document is the
requirements baseline for closing that gap.

> **Authoring note.** The active profile (`@markspec/profile-default`) does not
> declare an `STK` type, so this document captures requirements as numbered
> sections rather than `[STK_WIN_NNNN]` entry blocks. When a project profile
> declares `STK`, each `### STK-WIN-NNNN` heading below should be promoted to a
> real entry via `markspec insert STK <file>`.

## Audience

Three personas the spec must serve:

- **Native Windows author** — runs Windows 10 or 11 on a desktop or laptop,
  edits MarkSpec documents in VSCode, has never used WSL and does not want to.
- **Cross-platform contributor** — develops MarkSpec itself, needs the local
  test loop to work on whatever OS they happen to be on, and needs CI to catch
  Windows regressions before merge.
- **CI operator** — runs `markspec validate` and `markspec hook` from a
  Windows-based GitLab or GitHub runner as a pre-commit check on customer
  documentation repositories.

## Requirements

### STK-WIN-0001 — CLI binary runs natively on Windows

The compiled `markspec.exe` binary shall execute every subcommand listed in
[AGENTS.md §CLI subcommands](../../AGENTS.md#cli-subcommands) on Windows 10
(22H2 or later) and Windows 11, invoked from PowerShell 5.1, PowerShell 7+,
`cmd.exe`, and Git Bash, with behaviour identical to the macOS and Linux builds.

**Verification.** A `windows-latest` runner in CI executes the full e2e test
suite against the freshly compiled `markspec.exe` on every pull request.

### STK-WIN-0002 — File URIs round-trip on Windows

The LSP server shall emit RFC 8089-conformant `file:` URIs for Windows paths.
For a path `C:\foo\bar.md` the emitted URI shall be `file:///C:/foo/bar.md` and
the inverse `uriToPath` shall return the original path with platform-native
separators.

**Verification.** Unit test in `packages/markspec/lsp/util_test.ts` that asserts
round-trip equality for at least one Windows-style path (`C:\foo\bar.md`), one
POSIX path (`/home/user/foo.md`), and one path containing spaces and Unicode
characters.

### STK-WIN-0003 — Path construction is platform-aware

Every file path constructed by core, LSP, MCP, or CLI code shall use
`@std/path`'s `join` (or an equivalent platform-aware helper) rather than string
concatenation with `/`. The resulting paths shall use the host's native
separator everywhere they are returned to LSP clients, written to output
artefacts, or compared for equality.

**Verification.** A lint rule or grep-based pre-commit check rejects new
`${dir}/${name}`-style path concatenation in `packages/markspec/`. Existing
occurrences in `lsp/server.ts:walkDirectory` and `mcp/project.ts:walkFs` are
migrated.

### STK-WIN-0004 — CRLF line endings are normalised at the parse boundary

The Markdown parser shall accept files with CR, LF, or CRLF line endings and
shall not propagate `\r` characters into entry bodies, attribute values, or
diagnostic locations. The formatter shall preserve the original line-ending
convention of the file when writing back, so a CRLF file remains CRLF after
`markspec format`.

**Verification.** Unit tests with fixtures containing each line-ending
convention assert that parsed entry bodies contain no `\r`, and that formatter
write-back preserves the original ending.

### STK-WIN-0005 — VSCode extension works end-to-end on Windows

The MarkSpec VSCode extension shall start the LSP server, deliver diagnostics,
complete entry blocks, and support every other capability listed in
`lsp/server.ts` `onInitialize` on Windows 10 and Windows 11. The extension shall
resolve `markspec.exe` from the same installation locations the CLI spec covers
([STK-WIN-0006](#stk-win-0006--native-windows-installation-path-exists)).

**Verification.** A manual smoke-test checklist in `editors/vscode/README.md`
covering installation, opening a MarkSpec project, observing diagnostics,
running a code action, and renaming an ID, executed on Windows 11 before each
release.

### STK-WIN-0006 — Native Windows installation path exists

A native Windows installation method shall exist that does not require WSL, Git
Bash, or a POSIX shell. The installer shall download the latest stable
`markspec.exe`, place it on the user's `PATH`, and verify the installation by
running `markspec --version`.

**Decision.** The installer shall be a PowerShell script invoked as
`irm https://markspec.dev/install.ps1 | iex`, mirroring the UX of the existing
`install.sh`. Package-manager manifests (Scoop, winget) are deferred to a
follow-up story once the PowerShell installer is stable.

**Verification.** A `windows-latest` job in CI executes the PowerShell installer
from a clean runner and asserts `markspec --version` succeeds.

### STK-WIN-0007 — Windows regressions are caught before merge

The CI pipeline shall execute the full e2e test suite on a `windows-latest`
runner on every pull request. A failing Windows job shall block merge. The
Windows job shall not be marked as `continue-on-error` or otherwise downgraded
to a warning.

**Verification.** `.github/workflows/ci.yaml` includes a `windows-latest` matrix
entry. Branch protection on `main` lists the Windows job as a required check.

### STK-WIN-0008 — Windows installation and caveats are documented

The user guide shall document the native Windows installation procedure, list
any known caveats (e.g., long-path support, antivirus interaction with freshly
downloaded executables), and link the troubleshooting section from the top-level
README. The bootstrap script shall continue to direct contributors who want a
Unix-like environment toward WSL, but shall no longer be the only documented
path for end users.

**Verification.** `docs/guide/installation.md` (new or extended) covers the
Windows path; `README.md` links to it; bootstrap script error message is updated
to point at the Windows install method when run on Windows.

## Constraints

- **Single binary.** Windows support shall not require shipping multiple
  binaries or runtime-dispatch shims. The existing `deno compile` Windows target
  is the build mechanism.
- **No new runtime dependencies.** The CLI shall continue to run with only what
  `deno compile` bundles. No external DLLs, no PowerShell modules required at
  runtime.
- **No platform-specific subcommands.** All subcommands shall behave identically
  across platforms. Platform-specific behaviour, where unavoidable (path
  separators, line endings), shall be encapsulated in shared helpers, never
  branched in command handlers.

## Out of scope

- ARM Windows (`aarch64-pc-windows-msvc`). Defer until x86_64 is solid.
- Windows 7, 8, and Server editions older than 2019. We follow Microsoft's
  supported-OS matrix.
- Native installer alternatives beyond the PowerShell script — Scoop and winget
  manifests may be added later but are tracked separately.
- WSL improvements. WSL already works as a Linux environment.

## Open questions

- **Code signing.** Should `markspec.exe` be Authenticode-signed to avoid
  SmartScreen warnings? Cost vs. benefit decision pending.
- **Long-path support.** Does any subcommand depend on paths longer than 260
  characters? If so, the installer or manifest must opt the process into
  long-path support.
- **PowerShell version floor.** Target PowerShell 5.1 (ships with Windows 10) or
  require 7+? 5.1 is broader reach; 7+ is friendlier to author.

## Story breakdown

Once this spec is approved,
[#403](https://github.com/driftsys/markspec/issues/403) will be split into
stories along these seams:

1. **`pathToUri` Windows fix + tests** — unblocks the LSP (STK-WIN-0002).
2. **Path-join migration** — `@std/path` everywhere (STK-WIN-0003).
3. **CRLF normalisation in parser + formatter round-trip** — (STK-WIN-0004).
4. **`windows-latest` CI matrix** — full e2e suite (STK-WIN-0001, STK-WIN-0007).
5. **PowerShell installer + CI install smoke test** — (STK-WIN-0006).
6. **VSCode end-to-end Windows verification + manual checklist** —
   (STK-WIN-0005).
7. **Windows guide + bootstrap message update** — (STK-WIN-0008).

# Quickstart

Get MarkSpec running in 15 minutes. This chapter walks a single linear path from
install to a rendered HTML book with entry blocks and a traceability link.

## Step 1 — Install (2 min)

### Pre-compiled binary (recommended)

Downloads a self-contained binary — no Deno or Node.js required at runtime:

```sh
curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | sh
```

The installer detects your platform (macOS or Linux), downloads the release
binary, verifies the SHA256 checksum, and places it in `~/.local/bin`. Add that
directory to your `PATH` if it is not already there.

### Deno runtime (for Deno developers)

If you already have Deno installed and want to run MarkSpec from source:

```sh
deno install -g jsr:@driftsys/markspec
```

If `markspec` is not found after install, add `~/.deno/bin` to your `PATH`.

> **Run without installing:** `deno run jsr:@driftsys/markspec --help`

### Verify the install

```sh
markspec --version
```

## Step 2 — Create a project (1 min)

> **Coming soon: `markspec init`**
>
> A future release will scaffold a project with a single command. For now,
> create the files by hand — it takes 30 seconds.

Create a project directory and two configuration files:

```sh
mkdir my-project && cd my-project
```

Create `project.yaml`:

```yaml
name: my-project
version: "1.0.0"
```

Create `.markspec.yaml` (activates the default profile):

```yaml
profiles: []
```

That is enough to start. Both files are picked up automatically when you run any
MarkSpec command from inside `my-project/`.

## Step 3 — Author three entries (5 min)

Create `requirements.md` with a stakeholder requirement, a software requirement,
and a traceability link connecting them:

```markdown
# Requirements

- [STK_PRJ_0001] System availability

  The system shall be available 99.9% of the time.

- [SRS_PRJ_0001] Health check endpoint

  The service shall expose a `/health` endpoint returning `200 OK`.

      Satisfies: STK_PRJ_0001
```

An **entry** is a Markdown list item where:

- The display ID in `[…]` identifies the entry (`STK_PRJ_0001`).
- The rest of the list-item text is the title (`System availability`).
- The indented paragraph underneath is the body.
- An indented code block at the end holds attributes (`Satisfies:`).

## Step 4 — Format: stamp ULIDs (2 min)

Run `markspec fmt` to assign a permanent ULID to each entry:

```sh
markspec fmt requirements.md
```

```text
info: requirements.md:3 assigned Id: 01KPVVC9J2B1ZA64QZEMHF02PW to STK_PRJ_0001
info: requirements.md:9 assigned Id: 01KPVVC9J2B1ZA64QZEMHF02PX to SRS_PRJ_0001
2 file(s) formatted, 0 unchanged (2 total)
```

Your file now has `Id:` attributes:

```markdown
- [STK_PRJ_0001] System availability

  The system shall be available 99.9% of the time.

      Id: 01KPVVC9J2B1ZA64QZEMHF02PW

- [SRS_PRJ_0001] Health check endpoint

  The service shall expose a `/health` endpoint returning `200 OK`.

      Id: 01KPVVC9J2B1ZA64QZEMHF02PX
      Satisfies: STK_PRJ_0001
```

The ULID is a universally unique, immutable identifier. Once assigned it never
changes — even if the display ID or title is renamed.

## Step 5 — Check: verify traceability (2 min)

Run `markspec check` to confirm the link is intact:

```sh
markspec check requirements.md
```

No output means validation passed (exit code 0).

Now break a reference to see a failure:

```sh
# temporarily change "Satisfies: STK_PRJ_0001" → "Satisfies: STK_PRJ_9999"
markspec check requirements.md
```

```text
error[MSL-R080]: requirements.md:13 unresolved reference: STK_PRJ_9999
```

Restore the correct reference before continuing.

## Step 6 — Build: render an HTML book (2 min)

Create a minimal `SUMMARY.md`:

```markdown
# Summary

- [Requirements](requirements.md)
```

Build the site:

```sh
markspec book build
```

```text
wrote _site/requirements.html
wrote _site/index.html
```

## Step 7 — View the output (1 min)

Open `_site/index.html` in a browser. The entry blocks render with type-based
styling, display IDs, and clickable traceability links.

## Editor integration

The MarkSpec VS Code extension (`editors/vscode/` in the repository) provides
real-time diagnostics, entry block completion, and go-to-definition — all backed
by the same binary you just installed. See
[CLI guide — Editor and LSP integration](cli.md#editor-and-lsp-integration) for
setup instructions covering VS Code, Neovim, and other editors.

## Next steps

| I want to…                            | Go to                        |
| ------------------------------------- | ---------------------------- |
| Understand entries, shapes, and types | [Concepts](concepts.md)      |
| See all CLI flags and subcommands     | [CLI guide](cli.md)          |
| Set up a compliance profile           | [Profile guide](profiles.md) |
| Browse answers to common questions    | [FAQ](faq.md)                |

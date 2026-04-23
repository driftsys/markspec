# Configuration

Configure MarkSpec via `project.yaml`, `.markspec.yaml`, and CLI flags.

## project.yaml

Every MarkSpec project requires a `project.yaml` in the project root. MarkSpec
discovers it by walking up from the current directory.

### Minimal example

```yaml
name: my-project
version: "1.0.0"
```

### Complete example

```yaml
name: io.acme.braking-system
version: "2.3.0"
labels:
  - ASIL-A
  - ASIL-B
  - ASIL-C
  - ASIL-D
parents:
  - https://acme.com/refhub
parent-fallback: https://driftsys.github.io/refhub
```

### Fields

| Field             | Type     | Required | Default                             | Description                                               |
| ----------------- | -------- | -------- | ----------------------------------- | --------------------------------------------------------- |
| `name`            | string   | yes      | —                                   | Project name. Reverse-DNS convention recommended.         |
| `version`         | string   | yes      | `"0.0.0"`                           | Project version. Quote in YAML to avoid number coercion.  |
| `labels`          | string[] | no       | `[]`                                | Allowed label vocabulary. Empty means no constraint.      |
| `parents`         | string[] | no       | `[]`                                | Upstream parent registry URLs, searched in order.         |
| `parent-fallback` | string   | no       | `https://driftsys.github.io/refhub` | Fallback registry when parents don't resolve a reference. |

## .markspec.yaml

The `.markspec.yaml` file binds a project to one or more profile manifests. It
sits next to `project.yaml` in the project root.

### Example

```yaml
profiles:
  - ./profiles/markspec.yaml
```

### Profile specifiers

Three formats are supported:

**Local path** — relative to `.markspec.yaml`:

```yaml
profiles:
  - ./profiles/markspec.yaml
  - ../shared/markspec.yaml
```

**Git HTTPS** — cloned and cached locally:

```yaml
profiles:
  - git+https://github.com/acme/compliance-profiles.git#v1.0.0
```

**Git HTTPS with subpath** — for monorepos:

```yaml
profiles:
  - git+https://github.com/acme/profiles.git/aspice#v2.0.0
```

**Git file** — for local development:

```yaml
profiles:
  - git+file:///home/user/profiles.git#main
```

> Only one profile is supported in the current implementation. If multiple
> profiles are listed, a `PROFILE-LOAD-006` warning is emitted and only the
> first is used.

## Profile manifests

A profile manifest (`markspec.yaml`) declares the vocabulary for a project:
entry types, attributes, traceability rules, and display-ID patterns.

Profiles can extend other profiles via `extends:`, forming a chain. Child
profiles can add types and attributes, or tighten constraints (e.g., narrowing
cardinality, adding `required: true`) — but cannot relax them.

Use `markspec profile show` to inspect the active profile chain and
`markspec doctor` for a project health check.

See [ADR-008 — Profile System](../architecture/adr-008-profile-system.md) for
the full specification.

## Directory conventions

MarkSpec does not enforce a directory layout. By convention:

- `docs/` — Markdown files containing requirements and design documentation
- `src/` — source code with doc-comment entries (Rust `///`, Kotlin `/**`)
- `project.yaml` — project root marker

The `compile` and `report` commands accept explicit paths or globs:

```sh
markspec compile "docs/**/*.md"
markspec compile docs/requirements.md src/main.rs
```

## Editor integration

MarkSpec ships an LSP server (`markspec lsp`) that provides diagnostics and
completions. A VS Code extension is available at `editors/vscode/` in the
repository. See [Editor Integration](editor-integration.md) for setup
instructions covering VS Code, Neovim, and other editors.

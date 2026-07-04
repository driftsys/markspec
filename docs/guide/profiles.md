# Profile guide

> **Full profile guide coming in a future release.**
>
> This chapter is the primary resource for compliance leads who stack profiles
> to map a project to ASPICE, ISO 26262, or other standards. Its detailed
> content depends on the profile-schema implementation, which is in progress.

This chapter will cover profile stacking, ASPICE mapping, and ISO 26262
alignment. The current section documents how to bind a profile to a project —
the configuration that is already shipped.

---

## .markspec.yaml

The `.markspec.yaml` file binds a project to one or more profile manifests. It
sits next to `project.yaml` in the project root.

### Example

```yaml
profiles:
  - ./profiles/markspec.yaml
```

### Profile specifiers

Three schemes are supported. The leaf specifier in `.markspec.yaml` and the
`extends:` value inside a manifest both accept the same three forms.

**Local path** — relative to `.markspec.yaml`:

```yaml
profiles:
  - ./profiles/markspec.yaml
  - ../shared/markspec.yaml
```

**Git** — shallow + sparse clone, cached under the global cache directory.
Authentication is inherited from your git configuration, so private hosts
(including corporate GitLab) work without extra setup:

```yaml
profiles:
  # HTTPS, single-profile repo, tag-pinned
  - git+https://gitlab.example.com/platform/compliance-profile.git#v1.0.0
  # HTTPS with subpath, for monorepos holding several profiles
  - git+https://github.com/acme/profiles.git/aspice#aspice/v2.0.0
  # file:// for local development against a bare repo
  - git+file:///home/user/profiles.git#main
```

The fragment after `#` is a git tag (or branch for `file://` development). The
optional subpath between `.git` and `#` selects one profile inside a monorepo.

**npm** — resolved with `npm pack` and cached. Use this when your organization
distributes profiles through an npm registry or mirror (Nexus, Artifactory,
JFrog, or GitLab's npm package registry). The registry is whatever your `.npmrc`
points at:

```yaml
profiles:
  - npm:@markspec/profile-aspice-4@^1.2
  - npm:my-team-profile@1.0.0
```

> **At most one profile.** `.markspec.yaml` accepts a single content-bearing
> profile. Listing two or more is an error (`PROFILE-LOAD-006`) and no profile
> chain loads — compose standards by publishing a pre-merged profile, or chain
> them with `extends:` (see below), rather than stacking entries here. A bundled
> default profile loads automatically when `profiles:` is empty; opt out with
> `default-profile: false`.

---

## Profile manifests

A profile manifest (`markspec.yaml`) declares the vocabulary for a project:
entry types, attributes, traceability rules, and display-ID patterns.

Profiles can extend other profiles via `extends:`, forming a chain. Child
profiles can add types and attributes, or tighten constraints (e.g., narrowing
cardinality, adding `required: true`) — but cannot relax them.

Use `markspec profile show` to inspect the active profile chain,
`markspec profile describe <kind> <name>` to see one element (type, attribute,
relation, label, or convention) in full, and `markspec doctor` for a project
health check.

The normative manifest schema — every block, field, and diagnostic — lives in
[Annex B — Profile manifest schema](../spec/model/annex-profile-schema.md).

---

## Delivered documents

A profile can deliver document files to every project that consumes it — see
[ADR-030](../architecture/adr-030-profile-delivered-documents.md). Each file is
flagged, per file, as either a **traceable corpus** (its entries join the
consuming project's traceability graph) or **documentation-only** (surfaced for
humans and agents to read, never parsed).

```yaml
profile:
  delivers:
    - path: reference/platform-architecture.md
      corpus: true # entries join the consumer's graph
      description: Shared platform components and interfaces
    - path: reference/integration-guide.md
      # corpus defaults to false → documentation-only
```

| Key           | Type    | Required | Default | Notes                                                                               |
| ------------- | ------- | -------- | ------- | ----------------------------------------------------------------------------------- |
| `path`        | string  | yes      | —       | Relative to the profile directory (next to its `markspec.yaml`).                    |
| `corpus`      | boolean | no       | `false` | `true` → parse the file's entries into the consumer's graph. Markdown (`.md`) only. |
| `description` | string  | no       | —       | Shown in `profile show` and as the MCP resource description.                        |

**Path constraints.** `path` must stay inside the profile directory — an
absolute path or any `..` segment is a load-time error (`PROFILE-DELIVERS-003`).
`corpus: true` on a non-`.md` path is also a load-time error
(`PROFILE-DELIVERS-004`).

**Corpus eligibility.** Only Markdown files can be corpus files. A
documentation-only file can be any readable file (rendered as an MCP resource,
never parsed for entries).

**Merge semantics.** Across an `extends:` chain, `delivers:` is an additive
union keyed by `(profile-id, path)` — a child profile can add delivered
documents but never remove or override a parent's, matching every other manifest
section's non-relaxation rule. Two tiers delivering the same relative path never
collide; they are namespaced by their own `profile-id`.

**Consuming a delivered corpus.** No project-side configuration is needed beyond
the ordinary profile chain (`.markspec.yaml`) — `check`, `compile`, `show`,
`context`, `dependents`, `report`, `export`, the LSP, and the MCP server all
resolve trace targets living in the corpus automatically. A project entry
reusing a corpus display ID or `Id:` fails `check` with `MSL-R014` — the fix is
to rename the project entry; delivered corpus entries are read-only.

> **Local-path profiles must be excluded from project discovery.** A profile
> referenced with a local path (`./profile` in `.markspec.yaml`) lives inside
> the consumer's own repository tree. If `.markspec.yaml` does not `exclude:`
> that directory, the ordinary project walk parses the same corpus file the
> corpus loader also parses — the entries are indexed twice and self-collide as
> `MSL-R014`. Add the profile directory to `exclude:`:
>
> ```yaml
> # .markspec.yaml
> exclude:
>   - profile/
> ```
>
> Git and npm profile specifiers resolve into `.markspec/cache/<sha>/…`, which
> project discovery already skips — only a `local` specifier needs this.

See the
[reference architecture recipe](recipes/shipping-a-reference-architecture.md)
for a worked example, and ADR-030 for the collision-attribution and
lockfile-scope rules.

---

## Authoring and publishing a profile

A profile is a directory with a `markspec.yaml` manifest and a recommended
`README.md`. Scaffold one with:

```sh
markspec profile new my-profile          # or: @org/my-profile
```

This creates `my-profile/markspec.yaml` (a minimal manifest stub) and
`my-profile/README.md`.

Before distributing, validate the manifest:

```sh
markspec profile publish --dir ./my-profile
```

`profile publish` parses the manifest, reports any schema errors, and warns when
`description` or `license` is missing (`PROFILE-PUB-001` / `PROFILE-PUB-002`).
It exits non-zero on errors. **It validates only — it does not upload to any
registry.** Distribution itself is done with plain git or npm:

- **Git** — commit the profile directory and tag it (`git tag v1.0.0`). The
  `markspec.yaml` must sit at the repo root, or at the subpath named in the
  specifier. Consumers reference it with `git+https://…#v1.0.0`.
- **npm** — the profile directory is the npm package. Place `markspec.yaml` at
  the **package root** alongside a `package.json`, then `npm publish`. A minimal
  package:

  ```text
  my-profile/
  ├── package.json        # name, version, files: ["markspec.yaml","README.md"]
  ├── markspec.yaml       # the manifest — must be at the package root
  └── README.md
  ```

  ```json
  {
    "name": "@org/my-profile",
    "version": "1.0.0",
    "files": ["markspec.yaml", "README.md"]
  }
  ```

  The resolver runs `npm pack` and reads `markspec.yaml` from the tarball root,
  so keep the manifest at the top level (not nested in a subdirectory).

To wire a published profile into a project:

```sh
markspec profile add npm:@org/my-profile@^1.0
```

`profile add` validates the specifier and records it in `.markspec.yaml`. It
does **not** copy the profile into your repository — git and npm sources are
fetched and cached on demand the next time a profile-aware command runs.

---

## Discipline classification (SW / HW)

MarkSpec derives a software-or-hardware **discipline** for each requirement by
walking the `Allocated-to` graph upward from concrete components to the abstract
requirement, and tagging the requirement with the union of disciplines reached.
The result lands on `Entry.derivedDiscipline?` in compile output and flows into
reports.

See [ADR-017](../architecture/adr-017-discipline-classification.md) and
[ADR-018](../architecture/adr-018-core-discipline-ssot.md) for the design. Three
modes ship out of the box, selectable via the profile's `discipline-mode:`
field:

| Mode     | Behavior                                                                                   |
| -------- | ------------------------------------------------------------------------------------------ |
| `none`   | No discipline derivation. Recommended for projects that do not separate SW from HW.        |
| `flat`   | One `software-requirement` / `hardware-requirement` bucket per discipline. Default.        |
| `tiered` | Profile may declare per-discipline subtypes (e.g. `swe.software-requirement`). Compliance. |

Authors can override the derived value with the `Discipline:` trailer attribute,
and freeze the override with `Discipline-frozen: true`. Frozen overrides are
excluded from re-derivation.

The set of components recognized as the discipline source-of-truth lives in core
(`Item.discipline`); profiles may **extend** the vocabulary with new components
but cannot reclassify existing core components.

---

## Coming in a future release

- **ASPICE / ISO 26262 mapping** — how profile types correspond to process work
  products and safety integrity levels.
- **Profile stacking** — composing a project profile on top of a compliance base
  profile.
- **Type vocabulary reference** — all built-in types, their allowed attributes,
  and their traceability constraints.

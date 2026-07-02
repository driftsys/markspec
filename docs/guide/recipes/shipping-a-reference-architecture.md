# Shipping a reference architecture in a profile

A profile can deliver document files to every project that consumes it — see
[Delivered documents](../profiles.md#delivered-documents) and
[ADR-029](../../architecture/adr-029-profile-delivered-documents.md). This
recipe walks through the platform-team use case end to end: author a profile
that ships a reference architecture as a traceable corpus, consume it from a
project, and see what happens when a project entry collides with a corpus ID.

The layout below uses a `local` profile specifier (a directory inside the
project's own repository) so the recipe needs no network access. The same
`delivers:` section works unchanged for a `git+https://…` or `npm:` profile —
see [Profile specifiers](../profiles.md#profile-specifiers).

## 1. Author the profile

```text
profile/
├── markspec.yaml
└── reference/
    ├── platform.md      # corpus: true — joins the consumer's graph
    └── guide.md         # docs-only — read, never parsed
```

`profile/markspec.yaml` declares one requirement-shaped type per tier and a
`delivers:` section listing both files:

```yaml
id: platform-arch
version: 1.2.0
markspec-schema: "1"
profile:
  types:
    platform-component:
      extends: Requirement
      display-id-pattern: "PLT_{n:04d}"
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
      traceability:
        Satisfies:
          target: [platform-component]
          cardinality: 0..1
  delivers:
    - path: reference/platform.md
      corpus: true
      description: Reference platform architecture
    - path: reference/guide.md
      description: Integration guide (read-only reference)
```

`profile/reference/platform.md` is the corpus file — an ordinary MarkSpec
document, formatted and `Id:`-stamped like any other (run `markspec fmt` on it
inside the profile directory before shipping):

```markdown
- [PLT_0001] Platform core service

  The platform core service shall expose the vehicle state bus within 50 ms of a
  state change.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
      Type: platform-component
```

`profile/reference/guide.md` can be anything readable — it is surfaced to humans
and MCP-capable agents, never parsed for entries:

```markdown
# Integration guide

How to wire your service into the platform state bus.
```

## 2. Consume it from a project

Point `.markspec.yaml` at the profile directory:

```yaml
# .markspec.yaml
profiles:
  - ./profile
```

**Exclude the profile directory from project discovery.** The profile lives
inside the same repository tree, so without an `exclude:` entry the ordinary
project walk would parse `profile/reference/platform.md` a second time as an
ordinary project file — the same entries would be indexed once via discovery (no
`origin`) and once via the corpus loader (`origin` set), self-colliding as
`MSL-R014` against itself:

```yaml
# project.yaml
name: my-project
version: 0.1.0
exclude:
  - profile/
```

This step is specific to a `local` specifier. A `git+https://…#tag` or `npm:…`
profile resolves into `.markspec/cache/<sha>/…`, which project discovery already
skips — nothing to exclude there.

Now author a project requirement that traces into the corpus:

```markdown
<!-- docs/requirements.md -->

- [STK_0001] Vehicle state access

  The system shall read the vehicle state from the platform core service within
  100 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FB0
      Type: stakeholder-requirement
      Satisfies: PLT_0001
```

`PLT_0001` is never declared in the project — it lives entirely inside the
profile's delivered corpus.

## 3. Verify

```sh
markspec check
```

exits `0`. `Satisfies: PLT_0001` resolves against the corpus with no `MSL-L006`
warning — remove the `delivers:` section (or the `Satisfies:` target) and the
identical reference becomes an unresolved-target warning, confirming the corpus
is actually load-bearing rather than coincidentally passing.

```sh
markspec show PLT_0001 docs/requirements.md
```

prints the corpus entry with its provenance, and a `Source:` line in the stable
`<profile-id>@<version>:<path>:<line>:<column>` form rather than a raw
filesystem path:

```text
PLT_0001  Platform core service
  Type: platform-component
  Origin: platform-arch@1.2.0
  ...
  Source: platform-arch@1.2.0:reference/platform.md:1:1
```

```sh
markspec profile show
```

lists both delivered documents, with the corpus file's entry count and the
docs-only file's description:

```text
Delivered documents (2):
  - reference/platform.md   corpus   1 entries   [platform-arch]
  - reference/guide.md   doc      Integration guide (read-only reference)   [platform-arch]
```

## 4. See the collision gate fire

Add a second project file that reuses the corpus's display ID:

```markdown
<!-- docs/collide.md -->

- [PLT_0001] My own platform entry

  The colliding entry shall report a distinct status within 10 ms.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FC0
      Type: platform-component
```

```sh
markspec check
```

now exits `1` with `MSL-R014`, naming the delivering profile:

```text
error[MSL-R014]: docs/collide.md:1 display ID 'PLT_0001' is already delivered
by platform-arch@1.2.0; rename this entry — delivered corpus entries are
read-only
```

The fix is always to rename the project entry — the corpus entry is not yours to
change. Delete `docs/collide.md` (or rename its display ID) to return to a clean
`check`.

## Notes

- **Read-only by construction.** `markspec fmt` and rename never touch delivered
  corpus files — they are outside the discovered project file set entirely, not
  merely protected by a check.
- **Corpus-blind lockfile gate.** `markspec lock` and the `MSL-L212` drift gate
  only ever see project-authored edges; a `Satisfies:` edge between two corpus
  entries is invisible to both, by design (ADR-029 §D6, deferred lockfile
  integration).
- **A missing corpus file is a hard error.** If `profile/reference/platform.md`
  is absent from the published package, `check` fails with
  `PROFILE-DELIVERS-001` rather than silently compiling a partial graph.

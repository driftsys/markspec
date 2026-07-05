# Compile output

`markspec compile --output <dir>` writes the compiled traceability graph to a
directory of static files — the **`/api/`** directory. This output is what CI
publishes, what downstream projects federate against, and what auditors and
renderers consume.

## Directory layout

```text
<dir>/
├── manifest.json      ← always present; describes the project and entry counts
├── compiled.json      ← small projects (< 1 000 entries by default)
├── entries.ndjson     ← large projects (≥ split-threshold)
├── entries.idx        ← index file for fast NDJSON lookup
└── edges.ndjson       ← trace edges in NDJSON form (large projects)
```

The threshold between the two forms is set by `--split-threshold` (default 1
000). Both forms are always valid; consumers should check
`manifest.entries.format` to know which is present.

## Manifest

`manifest.json` is always small enough to parse in full. It describes the
project, counts entries and edges, and tells consumers where to find the entry
data:

```json
{
  "markspecSchemaVersion": 1,
  "generator": { "release": "0.6.0", "coreSchema": 1 },
  "project": { "name": "my-project", "version": "1.0.0" },
  "counts": { "entries": 1234, "edges": 456 },
  "entries": { "format": "ndjson", "file": "entries.ndjson" },
  "edges": { "format": "ndjson", "file": "edges.ndjson" },
  "sqliteMirror": null,
  "federation": [],
  "reserved": {}
}
```

## Entry record

Each entry record (in `compiled.json` or `entries.ndjson`) contains:

| Field               | Type                          | Notes                                                                                                                       |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `displayId`         | string                        | Human-readable identifier, e.g. `SRS_BRK_0107`                                                                              |
| `id`                | string \| null                | ULID or URI; null for entries without `Id:`                                                                                 |
| `shape`             | `"Authored"` \| `"Reference"` | Determined by `Id:` format                                                                                                  |
| `type`              | string \| null                | Resolved type, e.g. `requirement` or `Requirement`                                                                          |
| `title`             | string                        | Entry title (first line of list item)                                                                                       |
| `body`              | string                        | Entry body text                                                                                                             |
| `bodyTokens`        | `BodyToken[]`                 | Flat token stream (modal verbs, EARS triggers, Gherkin keywords, `$Identifier` entity refs, inline code). See ADR-016.      |
| `derivedDiscipline` | string[] \| undefined         | Disciplines reached by walking `Allocated-to`. ADR-017.                                                                     |
| `source`            | `EntrySource`                 | Tagged union: `{kind:"markdown"}` or `{kind:"doc-comment", language, function, rule}`. Replaces the pre-0.6.0 string field. |
| `rawAttributes`     | `{key, value}[]`              | All trailer attributes as parsed                                                                                            |
| `location`          | `{file, line, column}`        | Source location                                                                                                             |
| `properties`        | object                        | Observed facts: `file.*`, `git.*`, `source.*`                                                                               |

## Privacy

`sync.*` properties are **never** included in the compile output. They may
contain external-system tokens, user identifiers, or timestamps that should not
be archived or published. Only `file.*`, `git.*`, and `source.*` are serialized,
and `git.contributors` is opt-in.

## Schema versioning

`markspecSchemaVersion` is a monotonically increasing integer. Consumers must:

- Reject output with a version higher than they support.
- Accept output with unknown keys (additive-only evolution).
- Use this integer, not the generator `version`, for compatibility checks.

## Federation

`manifest.federation` lists the upstreams this project federates against — the
URLs of the `references:` upstreams declared in `project.yaml` (empty when none
are declared). Upstream entries are **not** fetched at resolution time.
`markspec lock` acquires each upstream once, over the network, and caches its
compiled snapshot under `.markspec/cache/upstreams/<id>/`; `check`, `compile`,
and the LSP then hydrate those snapshots **offline**, so resolution is
deterministic and reproducible.

Federation is **read-only and acyclic**: a project may resolve trace targets
that point _into_ an upstream's entries, but an upstream's own re-exported trace
targets never re-enter the consumer's graph — each entry keeps a single
authoritative source. A consumer never re-validates or re-classifies upstream
entries; their types come from the upstream's own profile.

For the normative schema see
[Core Data Model — Annex C](../internal/markspec-core-data-model.md#annex-c--serialized-form-compile-output).

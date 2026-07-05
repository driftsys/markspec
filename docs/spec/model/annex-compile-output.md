# Annex A — Compile output

`markspec compile --output <dir> <paths...>` writes the compiled traceability
graph to a directory of static files — the **`/api/`** directory. This output is
the archival, published artifact: what CI produces, what downstream projects
federate against, and what auditors and rendering pipelines consume.

The compile output is designed to be **served as static files** (e.g., on GitHub
Pages or GitLab Pages) and consumed by downstream tools without requiring a
running MarkSpec process.

## Generating the compile output

```bash
# Compile all Markdown and source files in docs/ and src/
markspec compile --output api/ docs/**/*.md src/**/*.rs

# Force streaming form (NDJSON) regardless of entry count
markspec compile --output api/ --split-threshold 0 docs/**/*.md

# Add a SQLite mirror for analytics consumers
markspec compile --output api/ --with-sqlite docs/**/*.md
```

## Directory layout

```text
<output-dir>/
├── manifest.json        always present
├── compiled.json        small projects (< 1 000 entries by default)
 or
├── entries.ndjson       large projects (≥ split-threshold)
├── entries.idx          index for O(1) entry lookup by display ID
└── edges.ndjson         trace edges (forward + generated inverses)
```

The threshold between the two forms is controlled by `--split-threshold`
(default: 1 000 entries). Both forms contain the same data — consumers should
check `manifest.entries.format` to determine which is present.

## Manifest schema

`manifest.json` is always small enough to parse in full. It is the entry point
for all consumers — read it first, then follow its pointers to the entry and
edge data.

```json
{
  "markspecSchemaVersion": 1,
  "generator": {
    "release": "0.6.0",
    "coreSchema": 1
  },
  "project": {
    "name": "my-project",
    "version": "1.2.0"
  },
  "counts": {
    "entries": 1234,
    "edges": 456
  },
  "entries": {
    "format": "ndjson",
    "file": "entries.ndjson"
  },
  "edges": {
    "format": "ndjson",
    "file": "edges.ndjson"
  },
  "sqliteMirror": null,
  "federation": [],
  "reserved": {}
}
```

For small projects, `entries.format` is `"inline"` and `entries.file` is
`"compiled.json"`.

| Field                   | Type                     | Notes                                                |
| ----------------------- | ------------------------ | ---------------------------------------------------- |
| `markspecSchemaVersion` | integer                  | Schema version; currently `1`                        |
| `generator.release`     | string                   | MarkSpec release version (informational only)        |
| `generator.coreSchema`  | integer                  | Core schema version; currently `1`                   |
| `project.name`          | string                   | From `project.yaml`                                  |
| `project.version`       | string                   | From `project.yaml`                                  |
| `counts.entries`        | integer                  | Total number of entries                              |
| `counts.edges`          | integer                  | Total number of edges (including generated inverses) |
| `entries.format`        | `"ndjson"` \| `"inline"` | Which form is present                                |
| `entries.file`          | string                   | Relative path to the entry data                      |
| `edges.format`          | `"ndjson"` \| `"inline"` | Which form is present                                |
| `edges.file`            | string                   | Relative path to the edge data                       |
| `sqliteMirror`          | string \| null           | Relative path to `mirror.db`, or `null`              |
| `federation`            | string[]                 | Declared upstream reference URLs (see Federation)    |
| `reserved`              | object                   | Reserved for future use; consumers must ignore       |

## Entry record

Each entry record appears as one JSON object — either as a line in
`entries.ndjson` (streaming form) or as a value in the `entries` map in
`compiled.json` (inline form).

```json
{
  "displayId": "SRS_BRK_0107",
  "id": "01HGW2Q8MNP3RSTVWXYZABCDEF",
  "shape": "Authored",
  "type": "requirement",
  "title": "Sensor debouncing",
  "body": "The sensor driver shall debounce raw inputs to eliminate noise.",
  "bodyTokens": [
    { "kind": "modal", "value": "shall", "line": 42, "column": 22 }
  ],
  "derivedDiscipline": ["software"],
  "source": { "kind": "markdown" },
  "rawAttributes": [
    { "key": "Id", "value": "01HGW2Q8MNP3RSTVWXYZABCDEF" },
    { "key": "Type", "value": "requirement" },
    { "key": "Derived-from", "value": "SYS_BRK_0042" },
    { "key": "Labels", "value": "ASIL-B" }
  ],
  "location": { "file": "docs/requirements.md", "line": 42, "column": 1 },
  "properties": {
    "file.path": "docs/requirements.md",
    "file.mtime": "2026-05-19T07:00:00Z",
    "git.sha": "a88ba34",
    "git.author": "Alice <alice@example.com>",
    "source.type": "markdown"
  }
}
```

For an in-source entry (Rust `///`, Kotlin `/**`, etc.), `source` is the
`doc-comment` variant:

```json
{
  "source": {
    "kind": "doc-comment",
    "language": "rust",
    "function": "swt_brk_0001_debounce_filters_noise",
    "rule": "outer-doc-comment"
  }
}
```

| Field               | Type                          | Notes                                                                                                                |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `displayId`         | string                        | Human-readable ID, e.g. `SRS_BRK_0107`                                                                               |
| `id`                | string \| null                | ULID or URI; `null` if no `Id:` trailer                                                                              |
| `shape`             | `"Authored"` \| `"Reference"` | Determined by `Id:` format                                                                                           |
| `type`              | string \| null                | Resolved type name; `null` if unresolved                                                                             |
| `title`             | string                        | Entry title text                                                                                                     |
| `body`              | string                        | Entry body text (trimmed)                                                                                            |
| `bodyTokens`        | `BodyToken[]`                 | Flat token stream — modal verbs, EARS triggers, Gherkin keywords, `$Identifier` entity refs, inline code. ADR-016.   |
| `derivedDiscipline` | string[] \| undefined         | Disciplines reached by walking `Allocated-to` edges. ADR-017.                                                        |
| `source`            | `EntrySource`                 | Tagged union: `{kind:"markdown"}` or `{kind:"doc-comment", language, function, rule}`. Pre-0.6.0 was a plain string. |
| `rawAttributes`     | `{key, value}[]`              | All trailer attributes in source order                                                                               |
| `location`          | `{file, line, column}`        | Source file path, 1-based line and column                                                                            |
| `properties`        | object                        | Observed facts (see Properties namespaces)                                                                           |

## Properties namespaces

The `properties` object is partitioned by namespace prefix. Only namespaces that
are available are populated — a property whose source data is absent is omitted
entirely rather than set to `null`.

| Namespace  | Fields                                   | Notes                                                     |
| ---------- | ---------------------------------------- | --------------------------------------------------------- |
| `file.*`   | `file.path`, `file.mtime`, `file.size`   | Always included                                           |
| `git.*`    | `git.sha`, `git.author`, `git.committer` | Included when git history is available                    |
| `source.*` | `source.language`, `source.function`     | Included for in-source entries (doc comments)             |
| `sync.*`   | (various)                                | **Never included** — privacy boundary (see Privacy rules) |

## Edge record

Each edge record appears as one JSON object in `edges.ndjson` (streaming form)
or in the `edges` array in `compiled.json` (inline form).

```json
{ "from": "SRS_BRK_0107", "to": "SYS_BRK_0042", "kind": "satisfies",    "generated": false }
{ "from": "SYS_BRK_0042", "to": "SRS_BRK_0107", "kind": "satisfied-by", "generated": true  }
```

| Field       | Type    | Notes                                        |
| ----------- | ------- | -------------------------------------------- |
| `from`      | string  | Source display ID                            |
| `to`        | string  | Target display ID                            |
| `kind`      | string  | Relation name in lowercase-with-hyphens      |
| `generated` | boolean | `true` for inverse edges written by MarkSpec |

The `kind` field uses lowercase-with-hyphens form (`satisfies`, not
`Satisfies`). This matches the display ID convention used in `entries.idx`.

## entries.idx

`entries.idx` is a JSON object mapping display ID to byte offset in
`entries.ndjson`. This allows O(1) random access to any entry without reading
the full NDJSON file:

```json
{
  "SRS_BRK_0107": 0,
  "SRS_BRK_0108": 1847,
  "SYS_BRK_0042": 3694
}
```

A consumer looking up `SRS_BRK_0107` reads the offset (`0`), seeks to that
position in `entries.ndjson`, reads one line, and parses the JSON object.

## Small-project form (inline)

For projects below the split-threshold, all data is in `compiled.json`:

```json
{
  "entries": {
    "SRS_BRK_0107": {
      "displayId": "SRS_BRK_0107",
      "id": "01HGW2Q8MNP3RSTVWXYZABCDEF",
      "shape": "Authored",
      "type": "requirement",
      "title": "Sensor debouncing",
      "body": "The sensor driver shall debounce raw inputs to eliminate noise.",
      "rawAttributes": [ ... ],
      "location": { "file": "docs/requirements.md", "line": 42, "column": 1 },
      "properties": { ... }
    }
  },
  "edges": [
    { "from": "SRS_BRK_0107", "to": "SYS_BRK_0042", "kind": "satisfies", "generated": false }
  ]
}
```

The `entries` field is a map keyed by display ID. The `edges` field is a flat
array. Both forms carry identical data — the split is a performance optimization
for large projects, not a semantic distinction.

## Privacy rules

The following rules govern what is and is not serialized in the compile output.
The output is designed to be published world-readable; these rules exist to
prevent sensitive data from leaking into the artifact.

- `sync.*` properties are **never** serialized. They may contain external-system
  tokens, user IDs, session timestamps, or workspace paths that should not
  appear in a published artifact.
- `git.contributors` is **opt-in** — it requires an explicit
  `--with-contributors` flag. By default, only `git.sha`, `git.author`, and
  `git.committer` are included, and only when git history is available.
- `file.path` records the path as written in the compile command, which may be
  relative or absolute depending on the invocation. CI pipelines should use
  project-relative paths for reproducible output.

## Schema versioning

`markspecSchemaVersion` is a monotonically increasing integer. The current
version is `1`.

**Compatibility rules:**

- Consumers **must reject** output with a `markspecSchemaVersion` higher than
  they support.
- Consumers **must ignore** unknown keys within any object. Schema evolution is
  additive-only — new fields are added, existing fields are never removed or
  renamed within a major version.
- Consumers must use `markspecSchemaVersion`, not `generator.version`, for
  compatibility checks. The generator version is informational.

When a breaking change is needed, `markspecSchemaVersion` is incremented and a
migration guide is published.

## Federation

`manifest.federation` lists the upstreams this project federates against — the
URLs of the `references:` upstreams declared in `project.yaml`. Downstream
projects can resolve trace targets that refer to entries in an upstream
project's compile output.

```json
{
  "federation": ["https://ci.example.com/safety-project/api/"]
}
```

Upstream entries are **never fetched at resolution time**. Acquisition happens
once, during `markspec lock`:

1. `markspec lock` reads `project.yaml`'s `dependencies:` (federated git
   repositories) and `references:` (published upstream compile-output sites).
2. It resolves and pins each upstream in `markspec.lock`:
   `[[upstream.dependency]]` rows for git repositories, `[[upstream.registry]]`
   rows for published sites.
3. It caches each upstream's compiled snapshot (a `manifest.json` +
   `compiled.json`/NDJSON pair) under `.markspec/cache/upstreams/<id>/`.
4. `check`, `compile`, and the LSP hydrate those cached snapshots **offline** —
   no network access, no live HTTP fetch — so resolution is deterministic.

Federation is **read-only** and **acyclic**: a consumer may resolve a trace
target _into_ an upstream's entries, but an upstream's own re-exported targets
never re-enter the consumer's graph — each entry keeps a single authoritative
source. A consumer never re-validates or re-classifies upstream entries, and an
upstream cannot modify the consumer's compile output. See ADR-031.

## SQLite mirror

`markspec compile --output <dir> --with-sqlite` produces an additional
`mirror.db` file alongside the NDJSON files. This is the same data in SQLite
form, for analytics consumers (coverage dashboards, traceability explorers,
etc.) that prefer SQL queries over NDJSON.

`manifest.sqliteMirror` points to the mirror file when present:

```json
{
  "sqliteMirror": "mirror.db"
}
```

The SQLite mirror is **never** used as the LSP's working index — the LSP
maintains its own in-memory index rebuilt from source files. The mirror is an
output artifact only.

Table schema (abbreviated):

```sql
CREATE TABLE entries (
  display_id  TEXT PRIMARY KEY,
  id          TEXT,
  shape       TEXT NOT NULL,
  type        TEXT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  file        TEXT NOT NULL,
  line        INTEGER NOT NULL
);

CREATE TABLE edges (
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  generated   INTEGER NOT NULL  -- 0 or 1
);

CREATE TABLE properties (
  display_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL
);
```

# Traceability

This specification defines the MarkSpec traceability strategy across authoring,
inference, and persisted metadata.

The strategy is intentionally layered:

1. Markdown remains the primary authoring surface for requirements and links.
2. Missing provenance can be inferred from ULIDs and git history.
3. Inferred and integration metadata is frozen in `.markspec.lock` so audits do
   not rely only on mutable git history.

## 1. Required in Markdown

A requirement or reference is traceable only if core fields are present in
Markdown or doc comments:

- `Id:` for ULID identity
- display ID in the heading (`[SRS_BRK_0001]`, `ISO-26262-6`, etc.)
- link attributes (`Satisfies:`, `DerivedFrom:`, `Allocates:`, `Verifies:`,
  `Implements:`)

These fields are normative for graph construction and validation.

## 2. Optional in Markdown

Authoring metadata may be explicit in Markdown when migrating from external
systems or preserving authoritative legacy records:

- `CreatedAt:`
- `CreatedBy:`

If present, explicit values override inferred values.

## 3. Inferred Provenance

When explicit provenance is absent, MarkSpec derives metadata as follows:

- `createdAt`: decoded from ULID timestamp
- `createdBy`: commit author of ULID introduction (`git log -S <ulid>`)
- `updatedAt`: most recent content-touching timestamp from git blame
- `updatedBy`: most recent content-touching author from git blame

Inference is best-effort. If data cannot be inferred safely (for example in
shallow or rewritten history), values remain absent unless explicitly provided.

## 4. Lock File Contract (`.markspec.lock`)

Traceability metadata that should not pollute Markdown is persisted in a
committed machine-managed lock file at repository root:

- path: `.markspec.lock`
- never hand-edit
- commit it with requirement changes
- sort entries by ULID for deterministic diffs

### 4.1 Schema identity

The lock file schema is published at:

`https://driftsys.github.io/schemas/markspec/lock/v1.json`

### 4.2 Data model

ULID is the primary key.

```json
{
  "$schema": "https://driftsys.github.io/schemas/markspec/lock/v1.json",
  "entries": {
    "01HGW2Q8MNP3": {
      "displayId": "SRS_BRK_0001",
      "createdAt": "2024-01-15T10:23:45.123Z",
      "createdBy": "alice@example.com",
      "updatedAt": "2024-03-01T09:11:00.000Z",
      "updatedBy": "bob@example.com",
      "external": {
        "jira": {
          "ref": "PROJ-1234",
          "syncedAt": "2024-03-01T09:00:00.000Z",
          "direction": "export"
        }
      }
    }
  }
}
```

Required lock semantics:

- `displayId`: current display ID for human lookup and rename tracking
- `createdAt` / `createdBy`: stable provenance baseline
- `updatedAt` / `updatedBy`: latest content update provenance
- `external.<tool>.ref`: external system identifier
- `external.<tool>.syncedAt`: sync event timestamp
- `external.<tool>.direction`: `import` | `export` | `bidirectional`

## 5. Lifecycle Responsibilities

- `markspec format`
  - stamps missing ULIDs
  - initializes lock records for new ULIDs
  - updates `updatedAt` / `updatedBy` from content changes
  - does not overwrite explicit Markdown overrides
- `markspec validate`
  - warns when Markdown ULIDs are missing from `.markspec.lock`
  - validates lock consistency (display ID/ULID mapping)
- `markspec sync --tool <name>`
  - updates `external.<tool>` mapping and sync metadata

## 6. Determinism and Dirty Working Trees

Build artifacts remain deterministic by default. Runtime build timestamps are
not required in site schemas.

When optional metadata timestamps are emitted in site outputs, they must use
HEAD commit time (`git log -1 --format=%cI`) and must be omitted for dirty
working trees.

## 7. Relationship to Site API Schemas

Site API entry/reference JSON may include provenance fields (`createdAt`,
`createdBy`, `updatedAt`, `updatedBy`) enriched from `.markspec.lock` by ULID
join at site-build time.

This keeps authoring documents concise while preserving durable provenance and
external integration metadata.

## 8. Follow-up in `driftsys/schemas`

Create a lock schema package in `driftsys/schemas`:

- `markspec/lock/v1.json`
- `markspec/lock/README.md`
- `markspec/lock/tests/`

This repository (`driftsys/markspec`) remains the normative human-readable
specification. `driftsys/schemas` remains the machine-readable contract source.

# Migration guide

> **Stage 2 — content deferred.**
>
> This chapter will document how to migrate existing requirements documents,
> DOORS exports, and ReqIF files into MarkSpec format. Its content is deferred
> to Stage 2 of the MarkSpec documentation roadmap, after the toolchain
> distribution and profile-schema implementation are complete.

Per [project decision](../architecture/overview.md): no migration tooling or
backward-compatibility shims are provided until version 1.0. All migration paths
will be documented here when they ship.

Stage 2 will cover:

- **DOORS XML → MarkSpec** — automated export and ULID assignment.
- **ReqIF → MarkSpec** — type mapping and attribute preservation.
- **Display-ID renaming** — workspace-wide rename via the LSP or CLI.
- **Version upgrade notes** — breaking changes between MarkSpec releases.

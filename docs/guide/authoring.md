# Authoring guide

> **Content coming in a future release.**
>
> This chapter is the primary resource for architects who structure a project's
> requirements and architecture documentation. Its content depends on
> listing-directive support and profile-schema implementation, which are not yet
> shipped on `main`.

This chapter will cover:

- **Project layout** — recommended directory structure for multi-domain
  requirements documents.
- **Entry authoring workflow** — write, format, validate, review; the canonical
  `insert → fmt → check` loop for AI agents and human authors.
- **Traceability graph design** — how to structure `Satisfies:` chains across
  stakeholder requirements, software requirements, and test entries.
- **Listing documents** — authoring `glossary.md`, `components.md`, and
  `references.md` using the listing directives.
- **Profile-driven type vocabulary** — declaring and using project-specific
  entry types.
- **In-code specs** — embedding MarkSpec entry blocks in Rust `///` and Kotlin
  `/**` doc comments; the V-model colocated test convention.

Until this chapter ships, refer to [AGENTS.md](../../AGENTS.md) (§Test
conventions — V-model) for the in-code spec pattern, and the [CLI guide](cli.md)
for the authoring commands.

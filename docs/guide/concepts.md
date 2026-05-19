# Concepts

> **Content coming in a future release.**
>
> This chapter will cover the MarkSpec mental model: entries, shapes (Authored
> and Reference), types, traceability links, profiles, and listing directives.
> It is the skimmable reference all three audiences (architect, developer,
> compliance lead) read before diving into their audience-specific chapter.

This chapter will explain:

- **Entries** — the fundamental unit: a display ID, a title, a body, and a
  trailer block of attributes.
- **Shapes** — Authored entries (identified by a ULID stamped by
  `markspec
  format`) versus Reference entries (citations to external artefacts
  such as standards or upstream requirements).
- **Types** — the vocabulary layer declared by profiles; each type carries a
  display-ID pattern, allowed attributes, and traceability rules.
- **Traceability links** — directed edges in the requirement graph, created by
  trace attributes (`Satisfies:`, `Derived-from:`, `Verified-by:`, etc.).
- **Profiles** — layered manifests that declare type vocabulary, attribute
  rules, and display-ID patterns for a project or compliance standard.
- **Listing directives** — `glossary`, `components`, and `references` directives
  that generate structured listing documents from the entry graph.

Until this chapter ships, the canonical source is
[docs/spec/internal/markspec-core-data-model.md](../spec/internal/markspec-core-data-model.md)
(§1 — the two-layer model and type system).

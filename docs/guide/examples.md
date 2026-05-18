# Examples gallery

> **Coming soon.**
>
> This chapter will tour the in-repo example project — a thin slice of an
> automotive emergency-braking system — so you can clone it and modify it on day
> one.

The gallery will be grounded in the end-to-end test corpus at
`tests/fixtures/corpora/aspice-slice/`, which does not yet exist in the
repository. Once the corpus ships, this chapter will cover:

- **Project tour** — directory layout, `project.yaml`, `.markspec.yaml`, and the
  activated ASPICE slice profile.
- **Stakeholder requirements** — `STK` entries in Markdown, their display IDs,
  and how they form the root of the traceability graph.
- **Software requirements and tests** — `SRS` entries in Markdown, `SWT` entries
  colocated in Rust doc comments, and the `Satisfies:` links that connect them.
- **Listing documents** — the generated `glossary.md`, `components.md`, and
  `references.md`.
- **Cloning the example** — how to copy the corpus out of the repository and use
  it as the starting point for a new project.

In the meantime, the [Quickstart](quickstart.md) walks a smaller self-contained
example from scratch.

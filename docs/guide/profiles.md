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

---

## Profile manifests

A profile manifest (`markspec.yaml`) declares the vocabulary for a project:
entry types, attributes, traceability rules, and display-ID patterns.

Profiles can extend other profiles via `extends:`, forming a chain. Child
profiles can add types and attributes, or tighten constraints (e.g., narrowing
cardinality, adding `required: true`) — but cannot relax them.

Use `markspec profile show` to inspect the active profile chain and
`markspec doctor` for a project health check.

Scaffold a new profile with:

```sh
markspec profile new my-profile
```

This creates a `my-profile/` directory with a `markspec.yaml` manifest and a
`README.md`.

---

## Coming in a future release

- **ASPICE / ISO 26262 mapping** — how profile types correspond to process work
  products and safety integrity levels.
- **Profile stacking** — composing a project profile on top of a compliance base
  profile.
- **Type vocabulary reference** — all built-in types, their allowed attributes,
  and their traceability constraints.
- **Publishing profiles** — validating a profile for distribution with
  `markspec profile publish`.

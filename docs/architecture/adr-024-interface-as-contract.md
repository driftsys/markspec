# ADR-024: Interface as Contract

## Status

Accepted (2026-05-30). Shipped in PR #569.

## Context

The core type hierarchy (ADR-003 / `core/model/type_hierarchy.ts`) placed
`SoftwareInterface` and `HardwareInterface` as subtypes of `Component`
("system-level building blocks with identity"), alongside `SoftwareComponent`
and `HardwareComponent`:

```text
Component (abstract)
├── SoftwareComponent
├── HardwareComponent
├── SoftwareInterface     ← subtype of Component
└── HardwareInterface     ← subtype of Component
```

That parentage is a category error. An interface is not a *building block*; it
is the *specification of a boundary* — the agreement two components meet at.
Three observations forced the question:

- **Attribute audit.** `Component` declares six own-attributes
  (`Kind`, `Part-of`, `Realizes`, `Depends-on`, `Provides`, `Requires`). The
  interface subtypes genuinely used only **one** (`Part-of`). Worse, the most
  Component-specific relations point the wrong way: `Provides`/`Requires` are
  *ports* a component declares — the interface is their **target**, not their
  holder; an interface is `Realized-by` something, it does not author
  `Realizes`. `SoftwareInterface` declared **zero** own attributes.

- **The word "interface" is overloaded.** It smears three distinct concepts:
  1. the **contract** — the published agreement / API surface (a `.proto`, an
     OpenAPI doc, a PACT, an ICD message set);
  2. the **architectural connection** — "component A talks to component B", an
     edge in the architecture;
  3. the **service** a component offers and another consumes.
  These are not one type. Concept 1 is a *specification*; concept 2 is a *link*;
  concept 3 is *edges* (provider/consumer) between components and a contract.

- **Prior art.** UML (`Interface` is a `Classifier`, distinct from `Component`),
  SysML v1/v2 (`InterfaceBlock` / `InterfaceDefinition`, sibling to
  `Block`/`PartDefinition`), AUTOSAR (`PortInterface` distinct from
  `SwComponentType`), and ICD / INCOSE practice (an Interface Control *Document*
  is a specification artifact) all model an interface *definition* as a
  contract distinct from the component that provides or requires it. The
  interface-as-component reading is the one without support.

A note on naming explored during design: "HardwareContract" was rejected — it is
not a term used in the field. `SoftwareInterface` / `HardwareInterface` are the
established literature terms and are kept.

## Decision

**Re-parent `SoftwareInterface` and `HardwareInterface` from `Component` to
`Contract`** (in the `Specification` family). Names are unchanged.

```text
Specification (abstract)
├── Requirement
├── Test
├── Contract                  concrete; system-level interface agreement
│   ├── SoftwareInterface     re-parented; software; .proto/.openapi/.wsdl
│   └── HardwareInterface     re-parented; hardware; Bus-protocol, Voltage-level, …
├── Record
└── Risk

Component (abstract)
├── SoftwareComponent
└── HardwareComponent         ← physical connector/bus/transceiver lives here
```

`Contract` stays **concrete** and discipline-neutral (the system / ICD level).
`HardwareInterface` keeps its physical own-attributes (`Bus-protocol`,
`Connector-type`, `Voltage-level`, `Signal-direction`). A physical connector you
can hold is a `HardwareComponent`; its interface *spec* is a `HardwareInterface`.

### Relation model

A contract participates in three distinct component roles. Provider and consumer
are a symmetric pair; `Allocated-to` is **not** reused for them.

| Role | Authored relation | Source → Target | Inverse |
| --- | --- | --- | --- |
| Implementation (who builds it) | `Realizes` | Component/Unit → Contract | `Realized-by` |
| Provider (who offers it) | `Provides` | Component → Contract | `Provided-by` |
| Consumer (who needs it) | `Requires` | Component → Contract | `Required-by` |

- `Provides`/`Requires` are wired as `provides`/`requires` traceability link
  kinds (they previously existed as `Component` attributes but produced no
  edges). Their target rule is `[Contract]`, which — because target compatibility
  walks the type hierarchy — accepts `Contract` and every subtype
  (`SoftwareInterface`, `HardwareInterface`, profile-declared `API`/`ICD`, …).
- `Required-by` is now the inverse of `Requires`; `Depends-on`'s inverse is
  renamed `Depended-on-by` to free the name.
- **Interface discipline is type-driven** (`SoftwareInterface`→software,
  `HardwareInterface`→hardware). The provider relation is not `Allocated-to`, so
  the ADR-017 discipline walk does not run on interfaces and there is no
  "type vs provider" precedence question.

### Profile domain names

Profiles supply domain vocabulary via the existing `extends:` mechanism — there
is no type-alias feature and none is added:

```yaml
types:
  API: { extends: SoftwareInterface }   # services profile
  ICD: { extends: Contract }            # automotive / system profile
```

### Rejected / out of scope

- **`HardwareContract`** — not a real term (see Context).
- **A core `Service` type** — a SOA/gRPC "service" is a `SoftwareComponent`
  that `Provides` a `Contract`; the proto `service {}` block / WSDL / OpenAPI doc
  is the `Contract`. A `Service` subtype, if wanted, is a profile concern.
- **An `Element` abstract parent over `{Component, Unit}`** (ASPICE-4.0
  "element" alignment + hoisting the `Part-of`/`Realizes`/`Depends-on` they
  share) — deferred to a separate phase. Note: ASPICE's element→component→unit
  is a *containment* ladder, already modeled by the `Part-of` link, not a
  generalization; only the generalization reading would be a type-tree change.

## Consequences

- **Validator.** `attributesForType` now resolves interfaces through the
  `Specification`→`Contract` chain, so `Satisfies`/`Derived-from`/`Schema-language`
  are valid on an interface and the `Component` relations are not (MSL-T022
  reflects this). The `MSL-R083` target-type matrix was reconciled:
  `Tests`/`Affects` gained `Contract` (interfaces stay valid targets);
  `Provides`/`Requires` target `[Contract]`.
- **Components listings.** `SoftwareInterface`/`HardwareInterface` were removed
  from the components-listing family (`MSL-L043`) — they are specs, not BOM
  components.
- **Lockfile.** The lockfile edge extractor now records `Provides`/`Requires`
  edges (its trace-key list was independent of the compiler's).
- **LSP.** `Provides`/`Requires` are registered in the trace-keyword lists
  (completion + doc-comment context), like every other trace key.
- **Supersedes.** The type tree embedded in
  [ADR-017](./adr-017-discipline-classification.md) still shows interfaces under
  `Component`; that tree is historical — this ADR is the current source of truth
  for interface parentage.
- **Known hazard (follow-up).** Trace-relation / type-family metadata is
  duplicated across four files — `ATTR_TO_LINK_KIND` (compiler), `TRACE_RULES`
  (validator), `TRACE_KEYS` (lock), and `COMPONENT_FAMILY` (listing). This change
  had to update all four by hand; a half-update shipped in the first PR commit
  and was caught only in review. A single-source-of-truth refactor for these
  lists is recommended so a relation/type change cannot half-land.
- **No migration.** Pre-1.0; `Type:` semantics changed without migration tooling.

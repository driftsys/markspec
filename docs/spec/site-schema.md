# Site Schema Specification

This document specifies the static site generator (`markspec site build`) and
its JSON API. It defines the output file tree, JSON schemas, HTML page types,
build pipeline, inter-project dependency model, process project integration,
tool configuration, and AI context delivery.

The site generator produces a complete static site with HTML pages and a JSON
API covering all entry types (STK, SYS, SRS, SAD, ICD, VAL, SIT, SWT, custom,
references), traceability, coverage, product BOM, and inter-project
dependencies. The design follows the refhub pattern (specification-first,
data-first, pregenerated, no runtime) but is configurable via `.markspec.toml`
with overridable templates and pluggable page modules.

JSON schemas referenced by the generated API are published in the
`driftsys/schemas` repository, not in each generated site.

---

## 1. Inter-Project Dependencies

### 1.1 Declaration (`project.yaml`)

Three fields declare project-level relationships:

- **`process`** -- governance. Process projects define entry types, attributes,
  constraints, and policies. Multiple processes supported; constraints
  accumulate (most restrictive wins).
- **`dependencies`** -- consumption. Projects this project needs. The compiler
  expects entries to link across the boundary and warns on coverage gaps.
- **`references`** -- citation. External registries and standards. References
  are traceability leaves -- the compiler resolves links to them but expects no
  deeper chain.

```yaml
# braking-features/project.yaml
name: io.acme.braking-features
version: "1.0.0"
category: specification
classification: confidential
labels: [ASIL-D]

process:
  - url: https://github.com/acme/process-v2
    version: "2.1"
    name: ACME Process

dependencies:
  - url: https://github.com/acme/abs-component
    version: "0.3"
    name: ABS
  - url: https://github.com/acme/esc-component
    version: "0.2"
    name: ESC

references:
  - url: https://driftsys.github.io/refhub
    name: RefHub
```

Each entry has the shape `{ url, version?, name? }`:

- **`url`** -- repository or published site URL.
- **`version`** -- version of the referenced project.
- **`name`** -- short display name (also used for inline disambiguation).

Dependencies flow down the product tree. Traceability flows up via entry-level
links:

```text
Product (depends: Features)
  Feature (depends: Components, references: RefHub)
    SYS → Allocates: CMP_ABS (dependency → full chain expected)
    SYS → Allocates: CMP_SENSOR (reference → leaf, no deeper chain)
  Component (depends: Libraries)
    SRS → Satisfies: SYS (traces back to feature)
```

### 1.2 Inline Reference Syntax

Authors write entry IDs as usual. Resolution order:

1. Current project.
2. Each dependency in declared order.
3. Each reference in declared order.
4. `markspec:references` directives (per-file additions).

```markdown
<!-- markspec:references io.acme.braking-features -->

- [SRS_ABS_0001] Wheel speed sampling rate

  Satisfies: SYS_BRK_001\
  Derived-from: ISO-26262-6 §7.4\
  Id: SRS_01HGW2Q8MNP3
```

`SYS_BRK_001` is not found in the current project, so it is searched in
dependencies (first declared order) and found in `braking-features`.
`ISO-26262-6` is not found locally or in dependencies, so it is searched in
references and found in `refhub`.

When a reference is ambiguous (same ID exists in multiple dependencies), use the
`name/ID` form:

```markdown
Satisfies: ABS/SYS_BRK_001
```

Ambiguous unqualified references produce a warning diagnostic.

`markspec:references` directives add resolution sources per-file, narrowing or
extending the project-level `references` scope.

### 1.3 Machine Output (API JSON)

Generated JSON uses PURL for cross-project link targets:

```json
{
  "links": {
    "satisfies": [{
      "displayId": "SYS_BRK_001",
      "title": "ABS activation threshold",
      "project": {
        "name": "io.acme.braking-features",
        "purl": "pkg:spec/io.acme/braking-features@1.0",
        "url": "https://github.com/acme/braking-features"
      },
      "url": "../braking-features/entries/sys/sys_brk_001.html"
    }]
  }
}
```

### 1.4 No Cached Dependency Output

Cross-project dependency information is not stored as a separate artifact. The
compiler reads the full chain at build time from each target's `project.yaml`
and entries. This ensures the traceability graph is always current.

The traceability matrix and graph schemas already carry all cross-project link
data via the `project` field in link targets. No dedicated deps schema is
needed.

---

## 2. Output File Tree

The `markspec site build` command writes all output to a single `_site/`
directory (configurable via `--output` or `.markspec.toml`).

```text
_site/
+-- index.html                               # Dashboard: project stats, health, nav
|
+-- entries/                                  # HTML -- browsable entries
|   +-- index.html                           # All entries (filterable table)
|   +-- {type}/                              # Per-type: stk/, sys/, srs/, sad/, ...
|   |   +-- index.html                       # Type listing
|   |   +-- {display-id}.html                # Entry detail
|   +-- refs/                                # Reference entries
|   |   +-- index.html                       # Reference listing
|   |   +-- {display-id}.html                # Reference detail
|   +-- bom/
|       +-- index.html                       # Product BOM tree (expand/collapse)
|
+-- traceability/
|   +-- index.html                           # Matrix view (table)
|   +-- graph.html                           # Interactive graph (D3)
|
+-- coverage/
|   +-- index.html                           # Coverage dashboard + gap lists
|
+-- diagnostics/
|   +-- index.html                           # Build diagnostics listing
|
+-- api/                                     # JSON API -- machine-readable
|   +-- index.json                           # Global index (project meta + type summary)
|   +-- search.json                          # Flat search index for MiniSearch
|   +-- entries/
|   |   +-- index.json                       # All entries summary
|   |   +-- {type}/
|   |   |   +-- index.json                   # Per-type index
|   |   |   +-- {display-id}.json            # Entry detail + resolved links
|   |   +-- refs/
|   |   |   +-- index.json                   # Reference index
|   |   |   +-- {display-id}.json            # Reference detail
|   |   +-- bom/
|   |       +-- index.json                   # BOM tree
|   +-- traceability/
|   |   +-- matrix.json                      # Full traceability matrix
|   |   +-- graph.json                       # Nodes + edges for visualization
|   +-- coverage/
|   |   +-- index.json                       # Coverage stats + gap lists
|   +-- diagnostics/
|       +-- index.json                       # All diagnostics
|
+-- llms.txt                                 # AI discovery: project summary + API map
|
+-- assets/
    +-- style.css
    +-- search.js
    +-- graph.js
    +-- bom.js
    +-- vendor/
        +-- pico.classless.min.css
        +-- minisearch.esm.min.js
        +-- d3.min.js
```

**Slug conventions:**

- Type directories are lowercase: `srs/`, `stk/`, `sys/`.
- Display IDs are lowercased for file names: `srs_brk_0001.html`,
  `srs_brk_0001.json`.
- Reference slugs are kept as-is: `iso-26262-6.html`.

---

## 3. JSON Schemas (v1)

All schemas are published in the
[driftsys/schemas](https://github.com/driftsys/schemas) repository -- the single
source of truth for schema contracts. Generated API JSON references these schema
URLs via `$schema`. This section summarises each schema and its role in the site
API; see the schemas repository for the full JSON Schema definitions, validation
tests, and version policy.

Schemas use JSON Schema draft-07, `additionalProperties: false` on root objects,
and `$id` URLs following the pattern
`https://driftsys.github.io/schemas/markspec-{name}/v1.json`.

### 3.1 Schema Reference

| Schema                  | `$id` slug                        | Description                                                                                                                                                                 | API paths                                                                                                  |
| ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Link Target**         | `markspec-link-target/v1`         | Resolved reference to another entry, used in link arrays throughout the API. Includes optional cross-project `project` object with name, PURL, and URL.                     | (shared definition, not standalone)                                                                        |
| **Entry**               | `markspec-entry/v1`               | Single typed entry (STK, SYS, SRS, SAD, ICD, VAL, SIT, SWT, or custom) with body, attributes, labels, source location, and resolved bidirectional traceability links.       | `api/entries/{type}/{id}.json`                                                                             |
| **Reference**           | `markspec-reference/v1`           | Reference entry for external standards, documents, or norms. Adds `document`, `externalUrl`, `status`, `supersededBy`, and `referencedBy` links.                            | `api/entries/refs/{id}.json`                                                                               |
| **Index**               | `markspec-index/v1`               | Entry listing with scope, count, project metadata, and summary records.                                                                                                     | `api/index.json`, `api/entries/index.json`, `api/entries/{type}/index.json`, `api/entries/refs/index.json` |
| **Search**              | `markspec-search/v1`              | Flat array optimized for client-side MiniSearch indexing.                                                                                                                   | `api/search.json`                                                                                          |
| **Traceability Matrix** | `markspec-traceability-matrix/v1` | One row per entry with all ten link directions (satisfies/satisfiedBy, derivedFrom/derivedTo, allocates/allocatedBy, verifies/verifiedBy, implements/implementedBy).        | `api/traceability/matrix.json`                                                                             |
| **Traceability Graph**  | `markspec-traceability-graph/v1`  | Nodes and edges for D3 force-directed graph visualization.                                                                                                                  | `api/traceability/graph.json`                                                                              |
| **Coverage**            | `markspec-coverage/v1`            | Coverage statistics (requirements, tests, traceability percentages) and gap lists (orphans, unsatisfied, unverified).                                                       | `api/coverage/index.json`                                                                                  |
| **BOM**                 | `markspec-bom/v1`                 | Product architecture as a recursive tree of typed components (HWC, SWC, MEC). Captures `Part-of`, `Deployable-on`, allocated requirements, variants, and per-node coverage. | `api/entries/bom/index.json`                                                                               |
| **Diagnostics**         | `markspec-diagnostics/v1`         | Build diagnostics (error/warning/info counts and individual records with severity, code, message, and source location).                                                     | `api/diagnostics/index.json`                                                                               |
| **Lock**                | `markspec-lock/v1`                | Frozen sidecar metadata (`.markspec.lock`). ULID-keyed entries with authoring provenance and external sync metadata. See [Traceability](traceability.md) for lifecycle.     | (project file, not in site API)                                                                            |

### 3.2 MiniSearch Field Configuration

The search index (`api/search.json`) is consumed by MiniSearch on the client.
Field configuration:

| Field       | Indexed | Stored | Boost |
| ----------- | ------- | ------ | ----- |
| `displayId` | yes     | yes    | 5     |
| `title`     | yes     | yes    | 3     |
| `component` | yes     | no     | 2     |
| `labels`    | yes     | yes    | 1.5   |
| `satisfies` | yes     | no     | 1.5   |
| `body`      | yes     | no     | 1     |
| `entryType` | yes     | yes    | --    |
| `url`       | no      | yes    | --    |

### 3.3 BOM Component Types

Builtin component types (from ASPICE):

| Builtin | Description          | Example                           |
| ------- | -------------------- | --------------------------------- |
| HWC     | Hardware Component   | PCB, sensor, actuator, ECU        |
| SWC     | Software Component   | module, library, service, runtime |
| MEC     | Mechanical Component | housing, bracket, connector       |

SWC can host other SWCs at any depth. `Deployable-on` targets any SWC or HWC:

```text
SWC(plugin) --deploy-on--> SWC(app) --deploy-on--> SWC(VM) --deploy-on--> SWC(QNX) --deploy-on--> HWC(ECU)
```

RTC (Runtime Component) is a custom subtype of SWC that process projects can
define to distinguish infrastructure software (AUTOSAR, hypervisors, container
runtimes) from application software.

---

## 4. HTML Page Types

### 4.1 Landing Page (`/`)

Project name and version, global search bar, entry type cards with counts,
coverage health bar, and gap badges. Serves as the site dashboard and primary
navigation entry point.

### 4.2 All Entries (`/entries/`)

Filterable table of all entries across all types. Columns: display ID, title,
type, labels, coverage status. Sortable by any column. Filters for type, label,
and coverage status.

### 4.3 Type Listing (`/entries/{type}/`)

Scoped table showing entries of a single type, with a type description header
and a mini coverage bar. Same columns as the all-entries table.

### 4.4 Entry Detail (`/entries/{type}/{id}.html`)

Full entry view:

- Body text rendered from Markdown.
- Attributes table.
- Traceability panel showing all six link kinds (satisfies, derived-from,
  allocates, verifies, implements, and their inverses), bidirectional, with
  clickable links to target entries.
- Source location (file, line).
- Coverage badges (satisfied, verified).
- 1-hop ego graph showing immediate neighbors in the traceability graph.

### 4.5 Reference Detail (`/entries/refs/{id}.html`)

Reference-specific metadata: document number, external URL, status
(active/superseded/withdrawn), superseded-by link. A "referenced by" list shows
all entries that cite this reference via Derived-from.

### 4.6 Traceability Matrix (`/traceability/`)

Full matrix table with one row per entry and columns for each link kind. Column
toggle controls to show/hide link directions. Color-coded gap indicators. Export
links for CSV and JSON formats.

### 4.7 Traceability Graph (`/traceability/graph.html`)

D3 force-directed graph visualization. Nodes are colored by type category
(requirement, architecture, verification, custom, reference). Edges are styled
by link kind (satisfies, derived-from, allocates, verifies, implements).
Click-to-navigate to entry detail pages. Filter controls to show/hide types and
link kinds.

### 4.8 Coverage Dashboard (`/coverage/`)

Coverage statistics bars with percentages. Three gap tables:

- Orphans: entries with no traceability links in any direction.
- Unsatisfied: parent entries with no child satisfying them.
- Unverified: entries with no verification link.

Each gap entry links to its detail page.

### 4.9 BOM (`/entries/bom/`)

Product architecture tree showing CMP entries organized by `Part-of`. Each node
displays its element type (HWC, SWC, MEC, or custom subtype), `Deployable-on`
chains, allocated requirements, product variants, and coverage indicators.
Expand/collapse tree navigation.

### 4.10 Diagnostics (`/diagnostics/`)

Error, warning, and info counts displayed prominently. Filterable table of
diagnostics grouped by severity or by file. Each diagnostic shows code,
severity, message, and source location.

### 4.11 Navigation

Persistent top bar across all pages:

```text
[Project Name] vX.Y | Entries | Traceability | Coverage | Search
```

### 4.12 Search

Client-side search powered by MiniSearch. The search index (`api/search.json`)
is lazy-loaded on first keystroke. Field boost configuration:

- `displayId`: 5
- `title`: 3
- `component`: 2
- `labels`: 1.5
- `satisfies`: 1.5
- `body`: 1

---

## 5. Build Pipeline

### 5.1 Data Flow

```text
project.yaml + *.md + *.rs/kt/c/...
        |
        v
   resolveProcess(config)           <-- read process projects, configure model
        |
        v
   resolveDeps(config)              <-- resolve dependencies + references
        |                              read each target's project.yaml + entries
        v
   compile(paths, opts, deps)       <-- compiler + dep context for cross-project refs
        |
        v
   CompileResult { entries, links, forward, reverse, diagnostics }
        |
        v
   buildSite(result, config)        <-- site generator entry point
        |
        +-- buildJsonApi()          -> api/**/*.json
        +-- buildSearchIndex()      -> api/search.json
        +-- buildTraceability()     -> api/traceability/{matrix,graph}.json
        +-- buildCoverage()         -> api/coverage/index.json
        +-- buildBom()              -> api/entries/bom/index.json
        +-- buildDiagnostics()      -> api/diagnostics/index.json
        +-- buildHtmlPages()        -> *.html (all pages)
        +-- copyAssets()            -> assets/**
        |
        v
   _site/
```

### 5.2 Module Location

```text
packages/markspec/site/
    mod.ts               # Public API: buildSite(result, config, opts)
    json/                # JSON generators (index, entry, search, trace, coverage, bom, diag)
    html/                # HTML generators (layout, landing, entries, trace, coverage, bom, diag)
    assets/              # CSS, JS (inline strings, following refhub pattern)
```

### 5.3 CLI Commands

```bash
markspec site build <paths...> [--output <dir>] [--base-url <url>]
markspec site dev   <paths...> [--port <port>]    # live preview (future)
```

- `--output` defaults to `_site/`.
- `--base-url` sets the path prefix when the site is deployed under a
  subdirectory.
- `markspec site build` calls `compile()` then `buildSite()`.
- `markspec site dev` is a future command for live preview with file watching.

### 5.4 Key Reuse

The site module reuses existing infrastructure:

- `compile()` from `core/compiler/mod.ts` -- full compilation pipeline.
- Coverage logic from `core/reporter/mod.ts` -- `computeCoverage()` is extracted
  or exported for reuse.
- `ProjectConfig` and all model types from `core/model/mod.ts`.
- HTML layout pattern from `book/site/mod.ts`.
- Same asset vendor approach as refhub (Pico CSS, MiniSearch, D3).

---

## 6. Process Projects

The entry model (custom types, attributes, traceability constraints) is defined
**as markspec entries in markdown** within process projects -- not in TOML
configuration. Process projects are real markspec projects that document the
process AND encode its rules as traceable entries.

### 6.1 Architecture

Projects declare process conformance via the `process` field in `project.yaml`:

```yaml
# braking-features/project.yaml
name: io.acme.braking-features
category: specification

process:
  - url: https://github.com/acme/process-v2
    version: "2.1"
    name: ACME Process
  - url: https://github.com/acme/safety-asild
    version: "1.0"
    name: Safety ASIL-D
```

```text
+----------------------------------+
|  Process project                 |  Defines:
|  (io.acme.process-v2)            |  - project types
|                                  |  - entry types, attributes
|  docs/process/*.md   <- entries  |  - constraints, policies
|  .markspec.toml      <- tool cfg |
|  project.yaml        <- identity |
+----------+-----------------------+
           | process (conforms-to)
    +------+------+
    v             v
+----------+ +----------+
| braking  | | steering |  Feature/component projects
| features | | features |  inherit the process model,
|          | |          |  can extend locally
+----------+ +----------+
```

Multiple processes are supported. Constraints accumulate (most restrictive
wins).

### 6.2 Process Entry Examples

Process projects define four things as markspec entries:

**Project types** -- what `category` values mean:

```markdown
# Project Types

- [PTYPE_001] Application

  Deployable end-user application.

  Id: PTYPE_01HGW2Q8MNP1

- [PTYPE_002] Feature Specification

  Requirements and architecture for a product feature.

  Id: PTYPE_01HGW2Q8MNP2
```

**Entry types** -- custom types mapped to builtins:

```markdown
# Entry Types

- [FReq] Functional Requirement

  Custom entry type mapped to the SYS builtin level. Used for functional
  requirements derived from stakeholder needs.

  Builtin: SYS Satisfies: STK Id: PROC_01HGW2Q8MNP3

- [SyReq] ECU System Requirement

  Custom entry type mapped to the SYS builtin level. Used for ECU-specific
  system requirements.

  Builtin: SYS Satisfies: FReq Id: PROC_01HGW2Q8MNP4

- [TC] Test Case

  Custom entry type mapped to the SWT builtin level.

  Builtin: SWT Verifies: SRS, SyReq Id: PROC_01HGW2Q8MNP5
```

**Custom attributes:**

```markdown
# Custom Attributes

- [ASIL] Automotive Safety Integrity Level

  Required attribute for safety-relevant entries.

  Type: string Values: QM, A, B, C, D Applies-to: STK, SYS, SRS Required: true
  Id: PROC_01HGW2Q8MNP6

- [Safety-Goal] Safety Goal Reference

  Type: string Values: SG-1, SG-2, SG-3 Applies-to: STK, FReq Id:
  PROC_01HGW2Q8MNP7
```

**Policies** -- reusable requirements with applicability to project types:

```markdown
# Policies

- [STK_PERF_001] Application startup time

  Application shall complete startup within 1 second.

  Applies-to: PTYPE_001\
  Compliance: mandatory\
  Id: STK_01HGW2Q8MNP8

- [STK_TRACE_001] Requirement traceability

  Every SRS entry must trace to a SYS or STK entry.

  Applies-to: PTYPE_002\
  Compliance: mandatory\
  Id: STK_01HGW2Q8MNP9
```

The compiler reads process entries from the declared process dependency and uses
them to configure the entry model and enforce policies for the consuming
project. Policy conformance is checked at compile time: every mandatory policy
that applies to the project's `category` must be satisfied by at least one
entry.

### 6.3 How It Works

- Process entries use markspec's own syntax -- they have IDs, are traceable, and
  are browsable on the process project's site.
- markspec reads process entries from the `process` field in `project.yaml` and
  uses them to configure the entry model for the consuming project.
- Custom types map to a **builtin** (`Builtin: SYS`) -- the traceability model
  stays fixed; only display ID patterns, display labels, and constraints change.
- The site/API structure is unchanged -- a `FReq` entry lives at
  `/entries/sys/`, shown with "FReq" as the display type.
- Component projects can **extend** the process model locally (add types or
  attributes) but cannot **weaken** it (remove required attributes or loosen
  constraints).
- `category` values are informative and may be defined by the process project
  (as project type entries). The schema does not enforce a fixed enum.
- Policy entries with `Applies-to` and `Compliance: mandatory` are enforced at
  compile time. Missing conformance produces a diagnostic error.

### 6.4 Process Project Layout

```text
acme-process-v2/
+-- project.yaml                    # name: io.acme.process-v2
+-- .markspec.toml                  # tool config (site settings only)
+-- docs/
|   +-- process/
|   |   +-- entry-types.md          # custom type definitions (as entries)
|   |   +-- attributes.md           # custom attribute schemas (as entries)
|   |   +-- traceability-rules.md   # constraint documentation
|   |   +-- activities/
|   |       +-- swe1-requirements.md
|   |       +-- swe2-architecture.md
|   |       +-- swe3-design.md
|   +-- glossary.md                 # reference entries for standards
```

---

## 7. Tool Configuration (`.markspec.toml`)

`project.yaml` stays tool-agnostic (project identity, version, classification,
labels, process, dependencies, references). All markspec-specific tool
configuration lives in `.markspec.toml`.

```toml
# .markspec.toml

# .markspec.toml is pure tool config -- no entry model here.
# Entry model (custom types, attributes, traceability rules)
# is defined as markspec entries in process projects.

# -- Site --

[site]
output = "_site"
base-url = "/braking-system"

[site.pages]
entries = true
traceability = true
coverage = true
bom = true
diagnostics = true

[site.templates]
path = "./my-templates"
```

**Templates:** HTML pages are generated from overridable Mustache templates.
Default templates ship with markspec. Users can provide a custom template
directory to override any page.

**Pluggable page modules:** Each page type is a module that:

- Receives the compiled data.
- Produces JSON and HTML output.
- Can be enabled or disabled via `.markspec.toml`.

This keeps the refhub approach (single build script, pregenerated output) but
makes it data-driven rather than hardcoded for one shape of content.

---

## 8. AI Context Delivery

Two complementary layers for AI assistants, both consuming the same compiled
data.

### 8.1 Static Markdown Layer (in site)

Generated `.md` files alongside `.json` for file-fetching AI agents (Copilot, CI
bots, review agents, context7). No running server needed.

```text
api/
  overview.md                          # Project summary, entry counts, health
  entries/
    {type}/
      index.md                         # Type overview: table of entries as markdown
      {display-id}.md                  # Entry detail: body, attributes, links inline
    refs/
      index.md
      {display-id}.md
    bom/
      index.md                         # BOM tree rendered as indented markdown
  traceability/
    matrix.md                          # Traceability matrix as markdown table
  coverage/
    index.md                           # Coverage narrative with gap highlights
  diagnostics/
    index.md                           # Diagnostics as markdown table
```

`llms.txt` at the site root serves as the AI discovery entry point -- project
summary, entry model description, and API map (what is available, where to
look).

### 8.2 MCP Server (interactive)

For live AI sessions (Claude Code, IDE extensions). Progressive context
delivery:

```text
markspec MCP server tools:

  search(query)         -> markdown results with snippets
  show(id)              -> full entry as markdown with resolved links
  context(id, depth?)   -> walk satisfies chain upward, return as tree
  dependents(id)        -> list entries depending on this one
  coverage(scope?)      -> narrative coverage summary with gap list
  bom(component?)       -> subtree of product architecture
  traceability(id?)     -> matrix row or full matrix as markdown
  diagnostics(file?)    -> diagnostics scoped to file or project
```

Progressive context flow:

1. AI reads `llms.txt` to understand the project shape.
2. Calls `search("brake sensor")` to get candidate entries.
3. Calls `show("SRS_BRK_0001")` to get the full entry with links.
4. Calls `context("SRS_BRK_0001")` to see the STK to SYS to SRS chain.
5. Calls `coverage(scope: "BRK")` to see gap analysis.

### 8.3 Why Both

| Layer        | Consumer                                   | Strengths                                                                |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| Static `.md` | File-fetching agents, CI, code review bots | Offline, no server, works with any tool that reads files/URLs            |
| MCP server   | Interactive agents (Claude Code, IDE)      | Live queries, progressive drill-down, scoped responses, lower token cost |

---

## 9. Design Decisions

- **Primary axis = entry type** (not domain). MarkSpec data is hierarchical by
  requirement level (STK to SYS to SRS), so type IS the decomposition level.
  Domain abbreviation (BRK, STEER) is a secondary filter.

- **Separate typed/reference schemas.** Different attribute sets warrant
  distinct schemas rather than one polymorphic shape.

- **BOM = product architecture, not requirement tree.** BOM components (`CMP_*`)
  are separate entries with typed elements (HWC, SWC, MEC). `Part-of` builds the
  product tree; `Allocates` links requirements to components. Builtin component
  types mirror the requirement model -- custom subtypes (ECU to HWC, RTC to SWC)
  defined via process projects.

- **Diagnostics in site.** Makes the site a complete build report for CI and
  auditor consumption without needing the CLI.

- **Three relationship types.** `process` (governance), `dependencies`
  (consumption, full traceability expected), `references` (citation,
  traceability leaf). Dependency kind is inferred from entry-level links, never
  declared at the project level.

- **Cross-project: auto-resolve + name disambiguation.** Authors mostly write
  bare IDs (auto-resolved across dependencies then references in order).
  `name/ID` syntax for disambiguation when needed. PURL in machine output only,
  never handwritten.

- **No cached dependency output.** The compiler reads the full chain at build
  time. Cross-project links are captured in the traceability matrix and graph
  schemas via the `project` field in link targets.

- **Schemas published separately.** JSON schemas live in the `driftsys/schemas`
  repository, not in each generated site. API JSON references schema URLs from
  that project.

- **JSON Schema draft-07.** Matches the `driftsys/schemas` repository
  convention. All root objects use `additionalProperties: false` for strict
  validation.

- **`$id` URL pattern.** All schema `$id` URLs follow
  `https://driftsys.github.io/schemas/markspec-{name}/v1.json`, consistent with
  the schemas repository's publishing structure.

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

Dependencies are declared in the project's `project.yaml`:

```yaml
# braking-system/project.yaml
name: io.driftsys.braking
domain: BRK
version: 0.3.0

dependencies:
  - name: io.driftsys.vehicle-platform # canonical project ID
    alias: vehicle # short name for inline refs
    path: ../vehicle-platform # local path (monorepo)
  - name: io.driftsys.refhub
    alias: refhub
    url: https://driftsys.github.io/refhub # remote (fetches api/*.json)
```

Fields:

- **`name`** -- canonical reverse-DNS project ID (from the dependency's own
  `project.yaml`).
- **`alias`** -- short name used for inline disambiguation in markdown
  attributes.
- **`path`** -- local filesystem path. markspec compiles the dependency from
  source.
- **`url`** -- remote URL. markspec fetches the dependency's published
  `api/*.json` files.

A dependency declares exactly one of `path` or `url`, never both.

### 1.2 Inline Reference Syntax

Authors write entry IDs as usual. Resolution order:

1. Current project.
2. Each dependency in declared order.

```markdown
- [SRS_BRK_0001] Brake sensor debouncing

  Satisfies: STK_SAFETY_001 Derived-from: ISO-26262-6 S7.4.3 Id:
  SRS_01HGW2Q8MNP3
```

`STK_SAFETY_001` is not found in the current project, so it is searched in
`vehicle` (first declared dependency) and found. `ISO-26262-6` is not found
locally or in `vehicle`, so it is searched in `refhub` and found.

When a reference is ambiguous (same ID exists in multiple dependencies), use the
`alias/ID` form:

```markdown
Satisfies: vehicle/STK_SAFETY_001
```

Ambiguous unqualified references produce a warning diagnostic.

### 1.3 Machine Output (API JSON)

Generated JSON uses PURL for cross-project link targets:

```json
{
  "links": {
    "satisfies": [{
      "displayId": "STK_SAFETY_001",
      "title": "Vehicle shall stop within 3s",
      "project": {
        "name": "io.driftsys.vehicle-platform",
        "purl": "pkg:spec/io.driftsys/vehicle-platform@1.0",
        "url": "../vehicle-platform"
      },
      "url": "../vehicle-platform/entries/stk/stk_safety_001.html"
    }]
  }
}
```

### 1.4 Dependants Discovery

Dependants ("who depends on me") are discovered when a project's published API
is fetched by downstream consumers. The site shows both directions:

- **Dependencies** -- projects I declare and consume (known at build time).
- **Dependants** -- projects that reference my entries (known when they build
  and publish, populated via the dependency's API or a shared registry).

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
|   |   +-- index.html                       # Product BOM tree (expand/collapse)
|   +-- deps/
|       +-- index.html                       # Dependencies & dependants
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
|   |   |   +-- index.json                   # BOM tree
|   |   +-- deps/
|   |       +-- index.json                   # Dependencies + dependants + cross-project links
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

All schemas use JSON Schema draft-07, matching the `driftsys/schemas` repository
convention. Root objects use `additionalProperties: false`. Schema `$id` URLs
follow the pattern `https://driftsys.github.io/schemas/markspec-{name}/v1.json`.

Schemas are published in the `driftsys/schemas` repository. Generated API JSON
references these schema URLs via `$schema`.

### 3.1 Link Target (shared definition)

The `linkTarget` object is used across multiple schemas to represent a resolved
link to another entry.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-link-target/v1.json",
  "title": "MarkSpec Link Target",
  "description": "A resolved reference to another entry, used in link arrays throughout the API.",
  "type": "object",
  "required": ["displayId", "title", "url"],
  "additionalProperties": false,
  "properties": {
    "displayId": {
      "type": "string",
      "description": "Human-readable display ID of the target entry."
    },
    "title": {
      "type": "string",
      "description": "Title of the target entry."
    },
    "entryType": {
      "type": "string",
      "description": "Entry type abbreviation (e.g., STK, SRS). Absent for reference entries."
    },
    "url": {
      "type": "string",
      "description": "Relative URL to the target entry's HTML page."
    },
    "project": {
      "description": "Present only for cross-project links.",
      "type": "object",
      "required": ["name", "purl", "url"],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "description": "Canonical reverse-DNS project ID."
        },
        "purl": {
          "type": "string",
          "description": "Package URL (PURL) for the external project."
        },
        "url": {
          "type": "string",
          "description": "Relative or absolute URL to the external project's site root."
        }
      }
    }
  }
}
```

### 3.2 Entry (`markspec-entry/v1.json`)

Represents a single typed entry (STK, SYS, SRS, SAD, ICD, VAL, SIT, SWT, or
custom type) with its resolved traceability links.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-entry/v1.json",
  "title": "MarkSpec Entry",
  "description": "A single typed entry with resolved traceability links.",
  "type": "object",
  "required": ["displayId", "title", "entryType", "source", "location"],
  "additionalProperties": false,
  "properties": {
    "displayId": {
      "type": "string",
      "pattern": "^[A-Z][A-Za-z]*_[A-Z]+_\\d{3,4}$",
      "description": "Human-readable display ID (e.g., SRS_BRK_0001)."
    },
    "title": {
      "type": "string",
      "description": "Entry title text."
    },
    "body": {
      "type": "string",
      "description": "Entry body rendered as Markdown."
    },
    "id": {
      "type": ["string", "null"],
      "description": "ULID identifier, null if not yet stamped."
    },
    "entryType": {
      "type": "string",
      "description": "Entry type abbreviation (e.g., STK, SRS, or a custom type like FReq)."
    },
    "source": {
      "type": "string",
      "enum": ["markdown", "doc-comment"],
      "description": "Whether the entry was parsed from a Markdown file or a source code doc comment."
    },
    "location": {
      "type": "object",
      "required": ["file", "line"],
      "additionalProperties": false,
      "properties": {
        "file": {
          "type": "string",
          "description": "Relative file path from the project root."
        },
        "line": {
          "type": "integer",
          "minimum": 1,
          "description": "Line number (1-based)."
        },
        "column": {
          "type": "integer",
          "minimum": 1,
          "description": "Column number (1-based)."
        }
      },
      "description": "Source location where the entry was defined."
    },
    "attributes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "value"],
        "additionalProperties": false,
        "properties": {
          "key": {
            "type": "string",
            "description": "Attribute name."
          },
          "value": {
            "type": "string",
            "description": "Attribute value."
          }
        }
      },
      "description": "Custom attributes defined on this entry."
    },
    "labels": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Labels attached to this entry (e.g., ASIL-B)."
    },
    "component": {
      "type": ["string", "null"],
      "description": "Component name, if the entry is scoped to a component."
    },
    "links": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "satisfies": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries this entry satisfies (outgoing upward link)."
        },
        "satisfiedBy": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries that satisfy this entry (incoming downward link)."
        },
        "derivedFrom": {
          "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json",
          "description": "Entry or reference this entry is derived from."
        },
        "derivedTo": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries derived from this entry."
        },
        "allocates": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Components this entry is allocated to."
        },
        "allocatedBy": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries allocated to this component."
        },
        "verifies": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries this entry verifies."
        },
        "verifiedBy": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries that verify this entry."
        },
        "implements": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries this entry implements."
        },
        "implementedBy": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries that implement this entry."
        }
      },
      "description": "Resolved traceability links, bidirectional."
    },
    "url": {
      "type": "string",
      "description": "Relative URL to this entry's HTML detail page."
    }
  }
}
```

### 3.3 Reference (`markspec-reference/v1.json`)

Represents a reference entry (external standards, documents, norms). Same base
shape as an entry but with different required fields and additional metadata.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-reference/v1.json",
  "title": "MarkSpec Reference",
  "description": "A reference entry for external standards, documents, or norms.",
  "type": "object",
  "required": ["displayId", "title", "source", "location"],
  "additionalProperties": false,
  "properties": {
    "displayId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9-]+$",
      "description": "Human-readable display ID (e.g., ISO-26262-6)."
    },
    "title": {
      "type": "string",
      "description": "Reference title."
    },
    "body": {
      "type": "string",
      "description": "Reference body rendered as Markdown."
    },
    "id": {
      "type": ["string", "null"],
      "description": "ULID identifier, null if not yet stamped."
    },
    "document": {
      "type": ["string", "null"],
      "description": "Document number or standard identifier."
    },
    "externalUrl": {
      "type": ["string", "null"],
      "format": "uri",
      "description": "URL to the external document."
    },
    "status": {
      "type": ["string", "null"],
      "enum": ["active", "superseded", "withdrawn", null],
      "description": "Current status of the referenced document."
    },
    "supersededBy": {
      "type": ["string", "null"],
      "description": "Display ID of the reference that supersedes this one."
    },
    "source": {
      "type": "string",
      "enum": ["markdown", "doc-comment"],
      "description": "Whether the reference was parsed from a Markdown file or a source code doc comment."
    },
    "location": {
      "type": "object",
      "required": ["file", "line"],
      "additionalProperties": false,
      "properties": {
        "file": {
          "type": "string",
          "description": "Relative file path from the project root."
        },
        "line": {
          "type": "integer",
          "minimum": 1,
          "description": "Line number (1-based)."
        },
        "column": {
          "type": "integer",
          "minimum": 1,
          "description": "Column number (1-based)."
        }
      },
      "description": "Source location where the reference was defined."
    },
    "attributes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "value"],
        "additionalProperties": false,
        "properties": {
          "key": {
            "type": "string"
          },
          "value": {
            "type": "string"
          }
        }
      },
      "description": "Custom attributes defined on this reference."
    },
    "labels": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Labels attached to this reference."
    },
    "links": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "referencedBy": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Entries that reference this document (via Derived-from)."
        }
      },
      "description": "Incoming links from entries that reference this document."
    },
    "url": {
      "type": "string",
      "description": "Relative URL to this reference's HTML detail page."
    }
  }
}
```

### 3.4 Index (`markspec-index/v1.json`)

Used for `api/index.json` (global), `api/entries/index.json` (all entries),
`api/entries/{type}/index.json` (per-type), and `api/entries/refs/index.json`
(references).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-index/v1.json",
  "title": "MarkSpec Index",
  "description": "Index of entries, scoped globally, by type, or by reference category.",
  "type": "object",
  "required": ["scope", "generated", "count", "entries"],
  "additionalProperties": false,
  "properties": {
    "scope": {
      "type": "string",
      "description": "Index scope: 'global', a type abbreviation (e.g., 'STK'), or 'refs'."
    },
    "generated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when this index was generated."
    },
    "count": {
      "type": "integer",
      "minimum": 0,
      "description": "Total number of entries in this index."
    },
    "project": {
      "type": "object",
      "required": ["name", "domain", "version"],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "description": "Canonical reverse-DNS project ID."
        },
        "domain": {
          "type": "string",
          "description": "Domain abbreviation (e.g., BRK)."
        },
        "version": {
          "type": "string",
          "description": "Project version string."
        }
      },
      "description": "Project metadata. Present only in the global index (scope = 'global')."
    },
    "types": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["abbreviation", "category", "count", "url"],
        "additionalProperties": false,
        "properties": {
          "abbreviation": {
            "type": "string",
            "description": "Entry type abbreviation (e.g., STK, SRS)."
          },
          "category": {
            "type": "string",
            "enum": [
              "requirement",
              "architecture",
              "verification",
              "custom",
              "reference"
            ],
            "description": "Entry type category for grouping and display."
          },
          "count": {
            "type": "integer",
            "minimum": 0,
            "description": "Number of entries of this type."
          },
          "url": {
            "type": "string",
            "description": "Relative URL to this type's index page."
          }
        }
      },
      "description": "Type summary with counts. Present in the global index."
    },
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["displayId", "title", "url"],
        "additionalProperties": false,
        "properties": {
          "displayId": {
            "type": "string",
            "description": "Human-readable display ID."
          },
          "title": {
            "type": "string",
            "description": "Entry title."
          },
          "entryType": {
            "type": "string",
            "description": "Entry type abbreviation. Absent for reference entries."
          },
          "labels": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Labels attached to this entry."
          },
          "url": {
            "type": "string",
            "description": "Relative URL to the entry's detail page."
          }
        }
      },
      "description": "Entry summaries in this index."
    }
  }
}
```

### 3.5 Search (`markspec-search/v1.json`)

Flat array optimized for client-side search with MiniSearch. Each element
contains the fields needed for indexing and the stored fields returned in search
results.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-search/v1.json",
  "title": "MarkSpec Search Index",
  "description": "Flat array of entry records optimized for MiniSearch indexing.",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["displayId", "title", "url"],
    "additionalProperties": false,
    "properties": {
      "displayId": {
        "type": "string",
        "description": "Human-readable display ID (indexed, stored, boost 5)."
      },
      "title": {
        "type": "string",
        "description": "Entry title (indexed, stored, boost 3)."
      },
      "entryType": {
        "type": "string",
        "description": "Entry type abbreviation (indexed, stored)."
      },
      "body": {
        "type": "string",
        "maxLength": 200,
        "description": "Truncated body text for indexing (indexed, not stored, boost 1)."
      },
      "component": {
        "type": ["string", "null"],
        "description": "Component name (indexed, not stored, boost 2)."
      },
      "labels": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Labels (indexed, stored, boost 1.5)."
      },
      "satisfies": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Display IDs of satisfied entries (indexed, not stored, boost 1.5)."
      },
      "url": {
        "type": "string",
        "description": "Relative URL to the entry's HTML page (stored, not indexed)."
      }
    }
  }
}
```

**MiniSearch field configuration:**

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

### 3.6 Traceability Matrix (`markspec-traceability-matrix/v1.json`)

Full traceability matrix with one row per entry, showing all link directions.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-traceability-matrix/v1.json",
  "title": "MarkSpec Traceability Matrix",
  "description": "Full traceability matrix with all link directions per entry.",
  "type": "object",
  "required": ["generated", "count", "rows"],
  "additionalProperties": false,
  "properties": {
    "generated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when this matrix was generated."
    },
    "count": {
      "type": "integer",
      "minimum": 0,
      "description": "Total number of rows (entries) in the matrix."
    },
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["displayId", "title", "entryType", "url"],
        "additionalProperties": false,
        "properties": {
          "displayId": {
            "type": "string",
            "description": "Human-readable display ID."
          },
          "title": {
            "type": "string",
            "description": "Entry title."
          },
          "entryType": {
            "type": "string",
            "description": "Entry type abbreviation."
          },
          "labels": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Labels attached to this entry."
          },
          "satisfies": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries this entry satisfies."
          },
          "satisfiedBy": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries that satisfy this entry."
          },
          "derivedFrom": {
            "type": ["string", "null"],
            "description": "Display ID of the entry this is derived from."
          },
          "derivedTo": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries derived from this entry."
          },
          "allocates": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of components this entry is allocated to."
          },
          "allocatedBy": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries allocated to this component."
          },
          "verifies": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries this entry verifies."
          },
          "verifiedBy": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries that verify this entry."
          },
          "implements": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries this entry implements."
          },
          "implementedBy": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Display IDs of entries that implement this entry."
          },
          "url": {
            "type": "string",
            "description": "Relative URL to the entry's HTML detail page."
          }
        }
      },
      "description": "One row per entry with all traceability links as display ID arrays."
    }
  }
}
```

### 3.7 Traceability Graph (`markspec-traceability-graph/v1.json`)

Nodes and edges for graph visualization (D3 force-directed layout).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-traceability-graph/v1.json",
  "title": "MarkSpec Traceability Graph",
  "description": "Nodes and edges for traceability graph visualization.",
  "type": "object",
  "required": ["nodes", "edges"],
  "additionalProperties": false,
  "properties": {
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "entryType", "category", "url"],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "description": "Display ID used as the node identifier."
          },
          "title": {
            "type": "string",
            "description": "Entry title for tooltip/label display."
          },
          "entryType": {
            "type": "string",
            "description": "Entry type abbreviation for styling."
          },
          "category": {
            "type": "string",
            "enum": [
              "requirement",
              "architecture",
              "verification",
              "custom",
              "reference"
            ],
            "description": "Type category for node coloring."
          },
          "hasGaps": {
            "type": "boolean",
            "description": "Whether this entry has traceability gaps (orphan, unsatisfied, unverified)."
          },
          "url": {
            "type": "string",
            "description": "Relative URL for click-to-navigate."
          }
        }
      },
      "description": "Graph nodes, one per entry."
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to", "kind"],
        "additionalProperties": false,
        "properties": {
          "from": {
            "type": "string",
            "description": "Display ID of the source node."
          },
          "to": {
            "type": "string",
            "description": "Display ID of the target node."
          },
          "kind": {
            "type": "string",
            "enum": [
              "satisfies",
              "derived-from",
              "allocates",
              "verifies",
              "implements"
            ],
            "description": "Link kind, used for edge styling."
          }
        }
      },
      "description": "Directed edges representing traceability links."
    }
  }
}
```

### 3.8 Coverage (`markspec-coverage/v1.json`)

Coverage statistics and gap lists for the project.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-coverage/v1.json",
  "title": "MarkSpec Coverage",
  "description": "Coverage statistics and gap analysis for the project.",
  "type": "object",
  "required": ["generated", "total", "coverage", "gaps"],
  "additionalProperties": false,
  "properties": {
    "generated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when coverage was computed."
    },
    "total": {
      "type": "integer",
      "minimum": 0,
      "description": "Total number of entries analyzed."
    },
    "byType": {
      "type": "object",
      "additionalProperties": {
        "type": "integer",
        "minimum": 0
      },
      "description": "Entry count per type (e.g., { \"STK\": 12, \"SRS\": 34 })."
    },
    "coverage": {
      "type": "object",
      "required": [
        "withSatisfies",
        "withoutSatisfies",
        "verified",
        "unverified",
        "satisfiedParents",
        "unsatisfiedParents"
      ],
      "additionalProperties": false,
      "properties": {
        "withSatisfies": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of entries that have at least one Satisfies link."
        },
        "withoutSatisfies": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of entries that have no Satisfies link (excluding top-level types)."
        },
        "verified": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of entries that have at least one verification link."
        },
        "unverified": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of entries with no verification link."
        },
        "satisfiedParents": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of parent entries that are satisfied by at least one child."
        },
        "unsatisfiedParents": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of parent entries with no child satisfying them."
        }
      },
      "description": "Aggregate coverage counters."
    },
    "gaps": {
      "type": "object",
      "required": ["orphans", "unsatisfied", "unverified"],
      "additionalProperties": false,
      "properties": {
        "orphans": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/gapEntry"
          },
          "description": "Entries with no traceability links in any direction."
        },
        "unsatisfied": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/gapEntry"
          },
          "description": "Parent entries with no child satisfying them."
        },
        "unverified": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/gapEntry"
          },
          "description": "Entries with no verification link."
        }
      },
      "description": "Lists of entries with traceability gaps."
    }
  },
  "definitions": {
    "gapEntry": {
      "type": "object",
      "required": ["displayId", "title", "entryType", "url"],
      "additionalProperties": false,
      "properties": {
        "displayId": {
          "type": "string",
          "description": "Human-readable display ID."
        },
        "title": {
          "type": "string",
          "description": "Entry title."
        },
        "entryType": {
          "type": "string",
          "description": "Entry type abbreviation."
        },
        "url": {
          "type": "string",
          "description": "Relative URL to the entry's HTML detail page."
        }
      }
    }
  }
}
```

### 3.9 BOM (`markspec-bom/v1.json`)

The BOM represents the **product architecture** -- a tree of typed components,
separate from the requirement traceability tree. Components are entries with the
`CMP` namespace and typed element types.

**Builtin component types** (from ASPICE):

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
runtimes) from application software. The hosting relationship is just
`Deployable-on` between SWCs -- no special type required.

Custom subtypes map to builtins (same pattern as requirements): ECU maps to HWC,
RTC maps to SWC, FPGA maps to HWC, etc. Defined via process projects.

**BOM-specific attributes:**

| Attribute     | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| Part-of       | Parent component (builds the tree).                                      |
| Element-type  | HWC, SWC, MEC, or a custom subtype.                                      |
| Deployable-on | Deployment target component.                                             |
| Variants      | Product variants/configurations (comma-separated, e.g., `LHD, Premium`). |

**BOM entry example:**

```markdown
- [CMP_BRK_001] Braking System

  Top-level system element for the braking domain.

  Element-type: system Id: CMP_01HGW2Q8MNP3

- [CMP_BRK_ECU_001] Brake ECU

  Element-type: ECU Part-of: CMP_BRK_001 Id: CMP_01HGW2Q8MNP4

- [CMP_BRK_SW_001] Brake Software

  Element-type: SWC Part-of: CMP_BRK_001 Deployable-on: CMP_BRK_ECU_001 Id:
  CMP_01HGW2Q8MNP5
```

Requirements link to BOM components via `Allocates`:

```markdown
- [SRS_BRK_0001] Sensor debouncing

  Allocates: CMP_BRK_ECU_001 Satisfies: STK_SAFETY_001
```

**Future extension -- Capabilities:** Component capability attributes for
projections and budget analysis. Examples: HW (memory, architecture, frequency),
SW (safety level, MCPS). Mechanism TBD -- extended markdown attributes or TOML
config. Enables views like "total memory budget per ECU" or "ASIL allocation
across components".

**Schema:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-bom/v1.json",
  "title": "MarkSpec BOM",
  "description": "Product architecture as a tree of typed components with deployment and allocation links.",
  "type": "object",
  "required": ["generated", "project", "version", "totalComponents", "roots"],
  "additionalProperties": false,
  "properties": {
    "generated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when the BOM was generated."
    },
    "project": {
      "type": "string",
      "description": "Canonical reverse-DNS project ID."
    },
    "version": {
      "type": "string",
      "description": "Project version string."
    },
    "totalComponents": {
      "type": "integer",
      "minimum": 0,
      "description": "Total number of CMP entries in the project."
    },
    "roots": {
      "type": "array",
      "items": { "$ref": "#/definitions/bomNode" },
      "description": "Top-level components (those with no Part-of attribute)."
    },
    "orphans": {
      "type": "array",
      "items": { "$ref": "#/definitions/bomNode" },
      "description": "Components not reachable from any root via Part-of chains."
    }
  },
  "definitions": {
    "bomNode": {
      "type": "object",
      "required": ["displayId", "title", "elementType", "builtinType", "url"],
      "additionalProperties": false,
      "properties": {
        "displayId": {
          "type": "string",
          "description": "Human-readable display ID (e.g., CMP_BRK_ECU_001)."
        },
        "title": {
          "type": "string",
          "description": "Component title."
        },
        "elementType": {
          "type": "string",
          "description": "Element type as declared (e.g., ECU, SWC, RTC)."
        },
        "builtinType": {
          "type": "string",
          "enum": ["HWC", "SWC", "MEC"],
          "description": "Builtin type the element type maps to."
        },
        "labels": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Labels attached to this component."
        },
        "url": {
          "type": "string",
          "description": "Relative URL to this component's HTML detail page."
        },
        "children": {
          "type": "array",
          "items": { "$ref": "#/definitions/bomNode" },
          "description": "Child components (those with Part-of pointing to this component)."
        },
        "deployedOn": {
          "oneOf": [
            {
              "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
            },
            { "type": "null" }
          ],
          "description": "Deployment target component (from Deployable-on attribute)."
        },
        "allocatedReqs": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Requirements allocated to this component (via Allocates attribute)."
        },
        "verifiedBy": {
          "type": "array",
          "items": {
            "$ref": "https://driftsys.github.io/schemas/markspec-link-target/v1.json"
          },
          "description": "Verification entries for this component."
        },
        "coverage": {
          "type": "object",
          "required": ["allocated", "verified"],
          "additionalProperties": false,
          "properties": {
            "allocated": {
              "type": "integer",
              "minimum": 0,
              "description": "Number of requirements allocated to this component."
            },
            "verified": {
              "type": "integer",
              "minimum": 0,
              "description": "Number of verification entries for this component."
            }
          },
          "description": "Coverage summary for this component."
        }
      }
    }
  }
}
```

### 3.10 Dependencies (`markspec-deps/v1.json`)

Cross-project dependency and dependant information.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-deps/v1.json",
  "title": "MarkSpec Dependencies",
  "description": "Cross-project dependencies and dependants with entry-level detail.",
  "type": "object",
  "required": ["generated", "project", "dependencies", "dependants"],
  "additionalProperties": false,
  "properties": {
    "generated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when the dependency data was generated."
    },
    "project": {
      "type": "string",
      "description": "Canonical reverse-DNS project ID of the current project."
    },
    "dependencies": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "alias", "purl", "url", "refs", "entries"],
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string",
            "description": "Canonical reverse-DNS project ID of the dependency."
          },
          "alias": {
            "type": "string",
            "description": "Short alias for inline disambiguation."
          },
          "purl": {
            "type": "string",
            "description": "Package URL (PURL) of the dependency."
          },
          "url": {
            "type": "string",
            "description": "URL to the dependency's site root."
          },
          "refs": {
            "type": "integer",
            "minimum": 0,
            "description": "Count of cross-project references to this dependency."
          },
          "entries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["displayId", "title", "referencedBy"],
              "additionalProperties": false,
              "properties": {
                "displayId": {
                  "type": "string",
                  "description": "Display ID of the dependency entry being referenced."
                },
                "title": {
                  "type": "string",
                  "description": "Title of the dependency entry."
                },
                "referencedBy": {
                  "type": "array",
                  "items": { "type": "string" },
                  "description": "Display IDs of local entries referencing this dependency entry."
                }
              }
            },
            "description": "Entry-level detail of which dependency entries are referenced."
          }
        }
      },
      "description": "Projects this project depends on (declared in project.yaml)."
    },
    "dependants": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "purl", "url", "refs", "entries"],
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string",
            "description": "Canonical reverse-DNS project ID of the dependant."
          },
          "purl": {
            "type": "string",
            "description": "Package URL (PURL) of the dependant."
          },
          "url": {
            "type": "string",
            "description": "URL to the dependant's site root."
          },
          "refs": {
            "type": "integer",
            "minimum": 0,
            "description": "Count of references from the dependant to this project."
          },
          "entries": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["displayId", "title", "references"],
              "additionalProperties": false,
              "properties": {
                "displayId": {
                  "type": "string",
                  "description": "Display ID of the dependant's entry."
                },
                "title": {
                  "type": "string",
                  "description": "Title of the dependant's entry."
                },
                "references": {
                  "type": "array",
                  "items": { "type": "string" },
                  "description": "Display IDs of this project's entries referenced by the dependant."
                }
              }
            },
            "description": "Entry-level detail of which of this project's entries are referenced."
          }
        }
      },
      "description": "Projects that depend on this project."
    }
  }
}
```

### 3.11 Diagnostics (`markspec-diagnostics/v1.json`)

Build diagnostics (errors, warnings, informational messages) from the
compilation pipeline.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://driftsys.github.io/schemas/markspec-diagnostics/v1.json",
  "title": "MarkSpec Diagnostics",
  "description": "Build diagnostics from the compilation pipeline.",
  "type": "object",
  "required": ["generated", "count", "bySeverity", "diagnostics"],
  "additionalProperties": false,
  "properties": {
    "generated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of when diagnostics were collected."
    },
    "count": {
      "type": "integer",
      "minimum": 0,
      "description": "Total number of diagnostics."
    },
    "byCode": {
      "type": "object",
      "additionalProperties": {
        "type": "integer",
        "minimum": 0
      },
      "description": "Diagnostic count per diagnostic code (e.g., { \"MSL-R003\": 2 })."
    },
    "bySeverity": {
      "type": "object",
      "required": ["error", "warning", "info"],
      "additionalProperties": false,
      "properties": {
        "error": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of error-level diagnostics."
        },
        "warning": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of warning-level diagnostics."
        },
        "info": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of informational diagnostics."
        }
      },
      "description": "Diagnostic count per severity level."
    },
    "diagnostics": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "severity", "message"],
        "additionalProperties": false,
        "properties": {
          "code": {
            "type": "string",
            "description": "Diagnostic code (e.g., MSL-R003)."
          },
          "severity": {
            "type": "string",
            "enum": ["error", "warning", "info"],
            "description": "Diagnostic severity level."
          },
          "message": {
            "type": "string",
            "description": "Human-readable diagnostic message."
          },
          "location": {
            "type": "object",
            "required": ["file", "line"],
            "additionalProperties": false,
            "properties": {
              "file": {
                "type": "string",
                "description": "Relative file path from the project root."
              },
              "line": {
                "type": "integer",
                "minimum": 1,
                "description": "Line number (1-based)."
              },
              "column": {
                "type": "integer",
                "minimum": 1,
                "description": "Column number (1-based)."
              }
            },
            "description": "Source location of the diagnostic, if applicable."
          }
        }
      },
      "description": "Individual diagnostic records."
    }
  }
}
```

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

### 4.10 Dependencies (`/entries/deps/`)

Two tables:

- **Dependencies table:** alias, canonical name, PURL, reference count, link to
  the dependency's site. Expandable rows showing which specific entries are
  referenced and by which local entries.
- **Dependants table:** canonical name, PURL, reference count, link to the
  dependant's site. Expandable rows showing which of this project's entries are
  referenced.

### 4.11 Diagnostics (`/diagnostics/`)

Error, warning, and info counts displayed prominently. Filterable table of
diagnostics grouped by severity or by file. Each diagnostic shows code,
severity, message, and source location.

### 4.12 Navigation

Persistent top bar across all pages:

```text
[Project Name] vX.Y | Entries | Traceability | Coverage | Search
```

### 4.13 Search

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
   resolveDeps(config)              <-- resolve dependencies
        |                              local path -> compile; URL -> fetch api/*.json
        v
   compile(paths, opts, deps)       <-- existing compiler + dep context for cross-project refs
        |
        v
   CompileResult { entries, links, forward, reverse, diagnostics, deps }
        |
        v
   buildSite(result, config)        <-- site generator entry point
        |
        +-- buildJsonApi()          -> api/**/*.json
        +-- buildSearchIndex()      -> api/search.json
        +-- buildTraceability()     -> api/traceability/{matrix,graph}.json
        +-- buildCoverage()         -> api/coverage/index.json
        +-- buildBom()              -> api/entries/bom/index.json
        +-- buildDeps()             -> api/entries/deps/index.json
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

```text
+----------------------------------+
|  Process project                 |  Defines the data model:
|  (io.acme.process-v2)            |  custom types, attributes,
|                                  |  traceability rules -- as
|  docs/process/*.md   <- entries  |  markspec entries
|  .markspec.toml      <- tool cfg |
|  project.yaml        <- identity |
+----------+-----------------------+
           | dependency
    +------+------+
    v             v
+----------+ +----------+
| braking  | | steering |  Component/feature projects
| project  | | project  |  inherit the process model,
|          | |          |  can extend locally
+----------+ +----------+
```

### 6.2 Process Entry Examples

Custom entry types are defined as markspec entries in the process project:

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

# Custom Attributes

- [ASIL] Automotive Safety Integrity Level

  Required attribute for safety-relevant entries.

  Type: string Values: QM, A, B, C, D Applies-to: STK, SYS, SRS Required: true
  Id: PROC_01HGW2Q8MNP6

- [Safety-Goal] Safety Goal Reference

  Type: string Values: SG-1, SG-2, SG-3 Applies-to: STK, FReq Id:
  PROC_01HGW2Q8MNP7
```

### 6.3 How It Works

- Process entries use markspec's own syntax -- they have IDs, are traceable, and
  are browsable on the process project's site.
- markspec reads process entries from dependencies and uses them to configure
  the entry model for the consuming project.
- Custom types map to a **builtin** (`Builtin: SYS`) -- the traceability model
  stays fixed; only display ID patterns, display labels, and constraints change.
- The site/API structure is unchanged -- a `FReq` entry lives at
  `/entries/sys/`, shown with "FReq" as the display type.
- Component projects can **extend** the process model locally (add types or
  attributes) but cannot **weaken** it (remove required attributes or loosen
  constraints).

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

`project.yaml` stays tool-agnostic (project identity, domain, version, labels,
dependencies). All markspec-specific tool configuration lives in
`.markspec.toml`.

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
deps = true
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
    deps/
      index.md                         # Dependencies + dependants as markdown
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

- **Cross-project: auto-resolve + alias disambiguation.** Authors mostly write
  bare IDs (auto-resolved across dependencies in order). `alias/ID` syntax for
  disambiguation when needed. PURL in machine output only, never handwritten.

- **Local path + URL resolution.** Local dependencies are compiled from source;
  remote dependencies are fetched from their published `api/` JSON. Works for
  monorepos and distributed setups.

- **Schemas published separately.** JSON schemas live in the `driftsys/schemas`
  repository, not in each generated site. API JSON references schema URLs from
  that project.

- **JSON Schema draft-07.** Matches the `driftsys/schemas` repository
  convention. All root objects use `additionalProperties: false` for strict
  validation.

- **`$id` URL pattern.** All schema `$id` URLs follow
  `https://driftsys.github.io/schemas/markspec-{name}/v1.json`, consistent with
  the schemas repository's publishing structure.

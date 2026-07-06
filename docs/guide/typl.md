# Using typl to declare identifier types

typl is the MarkSpec Type Specification DSL. It gives meaning to the `$Name`
tokens that appear in your entry bodies — by declaring their kind (signal,
command, event, …) and their shape (float range, record, enum, …).

---

## When do I use typl?

Use typl when an entry references `$Name` identifiers that represent typed
quantities, and you want:

- **Tooling support** — LSP hover shows the kind and shape of `$Name`; the
  compiler reports undefined references and duplicate published declarations.
- **Downstream codegen** — the `typeRegistry` in
  `markspec compile --format json` maps each identifier to its shape, ready for
  RIDL emitters or custom scripts.
- **Verification clarity** — a tester reading the requirement sees exactly what
  type and range `$Speed` carries, without hunting through other documents.

You do not need typl if your entry bodies contain no `$Name` identifiers, or if
the identifiers are self-explanatory from prose context alone.

---

## Which surface should I use?

Four Markdown surfaces are available. Choose based on how many declarations you
need and where they live relative to prose.

### Fence — for dense or structured declarations

Use a `` ```typl ``` `` fence when an entry carries multiple bindings and/or
typedefs. The fence groups them visually and keeps the prose clean.

````markdown
- [SYS_RADAR_0012] Radar track output

  The fusion module shall publish one `$Track` record per object at 100 ms.

  ```typl
  type Track = { id: int, range_m: float[0..300], velocity_ms: float }
  $Track   : signal Track
  $CycleHz : const int[10]
  ```

      Id: 01JZEXAMPLEULID000000000001
      Satisfies: STK_RADAR_0001
````

### Bullet glossary — for sparse or annotated lists

Use a `- $Name : …` bullet when the entry already contains a list and you want
to annotate a few identifiers without adding a fence. Reads as a glossary note.

```markdown
- [SRS_BRAKE_0030] Brake pedal debounce

  The controller shall debounce raw pedal readings over a `$Window` ms sliding
  window before emitting `$Stable`.

  - $Window : config int[1..50]
  - $Stable : signal bool

    Id: 01JZEXAMPLEULID000000000002
```

### Inline span — for a single identifier in prose

Use a `` `$Name : shape` `` backtick span to declare one identifier directly in
the sentence that mentions it. Keep this to one or two identifiers; use a fence
for more.

```markdown
- [SRS_CTRL_0005] Gain scheduling

  The controller shall apply a gain `$Gain : signal float[0.5..2.0]` selected
  from the scheduled gain table.

      Id: 01JZEXAMPLEULID000000000003
```

### Table — for many parallel declarations

Use a GFM table when an entry declares many identifiers that share the same
columns: one row per binding, holding the `$Name`, its `kind shape`, and a
description. The first two columns are read positionally; the description is
documentation only. Rows whose first cell is not a `$Name` are ignored, so a
table may mix declaration rows with plain notes.

```markdown
- [SYS_HMI_0007] Cluster display signals

  The cluster shall render each signal below within its stated range.

  | Signal        | Kind shape           | Description      |
  | ------------- | -------------------- | ---------------- |
  | $VehicleSpeed | signal float[0..300] | km/h, road speed |
  | $EngineRpm    | signal int[0..8000]  | crankshaft speed |

      Id: 01JZEXAMPLEULID000000000006
```

A shape that contains `|` (a union or enum) must escape each pipe as `\|` so GFM
does not read it as a column break; the cell un-escapes before typl parses it
(`| $Gear | 'P' \| 'R' \| 'N' \| 'D' | selected gear |`).

A `Table:` caption adjacent to the table may carry a published base — an
absolute name, dotted (`$a.b`) or single-segment (`$vehicle`) — which scopes the
table's relative rows (`$.x`) through the same entry-local resolver the bullet
surface uses:

```markdown
- [SYS_BRAKE_0009] Brake contract

  Table: $powertrain.brake

  | Signal           | Kind shape           | Description |
  | ---------------- | -------------------- | ----------- |
  | $.pedal_position | signal float[0..100] | pedal, %    |
  | $.line_pressure  | signal float[0..250] | bar         |

      Id: 01JZEXAMPLEULID000000000005
```

A table row resolves against its caption base, then the entry root. Unlike a
bullet, a table nested inside a namespace does not inherit that namespace's
base. Only bindings are expressed in tables; typedefs keep the fence, bullet, or
inline surfaces.

---

## Common patterns

### Declaring a signal

A signal is a continuously observable quantity. Pair it with a range shape to
capture the expected measurement domain.

```typl
$EngineRPM  : signal float[0..8000]
$OilPressure: signal float[0..10.0]
$FuelLevel  : signal int[0..100]
```

### Declaring a command with a record payload

A command carries a structured payload. Define the payload shape as a typedef,
then reference it in the binding.

```typl
type BrakeRequest = { force_N: float[0..12000], duration_ms: int[0..500] }
$ApplyBrake : command BrakeRequest
```

### Declaring a constant

A constant has a fixed value known at specification time.

```typl
$MaxRetries   : const int[3]
$DebounceMs   : const int[10]
$ProtocolVer  : const '2.1'
```

### Declaring an event

An event is a named occurrence. The shape carries the event data, if any. Events
with no payload omit the shape.

```typl
$CollisionAlert : event
$PedalPressed   : event { force_N: float[0..1500], timestamp: int }
```

### Mixing surfaces in one entry

All four surfaces share the same namespace within an entry. You can open a fence
for typedefs, then use bullets or a table for bindings, or vice versa. The
compiler merges them.

````markdown
- [SYS_LOG_0004] Diagnostic log record

  The system shall emit a `$LogRecord` document whenever a fault is detected.

  ```typl
  type Severity = 'info' | 'warn' | 'error' | 'fatal'
  type LogRecord = { ts: int, severity: Severity, code: int[0..255], msg: string }
  ```

  - $LogRecord : document LogRecord
  - $FaultRate : signal float[0..1.0]

    Id: 01JZEXAMPLEULID000000000004
````

---

## Publishing a symbol across entries

Everything above is **entry-local**: a plain `$Name` lives in the entry that
declares it, and two entries may declare `$Speed` independently. When a signal
is a shared contract — an interface every consumer must agree on — declare it
**once** as a _published_ symbol and cite it from the other entries.

A published symbol is a dotted, namespaced name declared exactly once across the
whole project. Declare a namespace, then hang the leaf signals off it with
relative `$.` references:

```markdown
- [ICD_BRAKE_0001] Brake subsystem signal interface

  `$powertrain.brake : namespace`

  - `$.pedal_position : signal float[0..100]` — pedal travel, percent
  - `$.line_pressure : signal float[0..250]` — hydraulic line pressure, bar

    Id: 01JZEXAMPLEULID000000000005
```

This declares two published symbols — `$powertrain.brake.pedal_position` and
`$powertrain.brake.line_pressure`. Any other entry cites one by its full dotted
path:

```markdown
- [SRS_BRAKE_0040] Emergency brake trigger

  The controller shall engage the emergency brake when
  `$powertrain.brake.line_pressure` drops below 50 bar within 20 ms.

      Id: 01JZEXAMPLEULID000000000006
      Satisfies: SYS_BRAKE_0007
```

Three rules to keep in mind:

- **Declared once.** Re-declaring a published symbol anywhere in the project is
  an error (TYPL-009).
- **Citations are absolute.** The relative `$.` form only works inside the
  declaring entry; another entry must spell out the full dotted path.
- **A published name is never bare.** Publication needs a namespace — `$speed`
  cannot be published as-is; give it an owner (`$vehicle.speed`).

---

## Compile output

Running `markspec compile --format json` on a project that contains typl
declarations produces two typl-specific fields in the output.

**Per-entry `types` field:**

```json
{
  "displayId": "SYS_RADAR_0012",
  "types": {
    "bindings": [
      {
        "name": "$Track",
        "kind": "signal",
        "shape": { "kind": "ref", "name": "Track" }
      },
      {
        "name": "$CycleHz",
        "kind": "const",
        "shape": { "kind": "range", "type": "int", "exact": 10 }
      }
    ],
    "typedefs": [
      {
        "name": "Track",
        "shape": {
          "kind": "record",
          "fields": {
            "id": { "kind": "primitive", "type": "int" },
            "range_m": {
              "kind": "range",
              "type": "float",
              "min": 0,
              "max": 300
            },
            "velocity_ms": { "kind": "primitive", "type": "float" }
          }
        }
      }
    ]
  }
}
```

**Corpus-level `typeRegistry`:**

At the top of the compile output, the `typeRegistry` maps every `$Name` to its
resolved binding across the whole document set — useful for codegen scripts that
need a flat lookup table.

```json
{
  "typeRegistry": {
    "$Track":   { "kind": "signal", "shape": { ... } },
    "$CycleHz": { "kind": "const",  "shape": { ... } }
  }
}
```

---

## Editor support

The MarkSpec LSP provides two typl affordances when you open a Markdown file:

- **Hover** — hovering over a `$Name` token shows its kind, shape, and where it
  is declared. A dotted published name (`$powertrain.brake.pedal_position`)
  shows its full path and declaring file; a relative `$.name` reference resolves
  against the entry's root namespace.
- **Completion** — inside a `typl` fence or after `$`, the LSP offers the
  workspace's declared names. Inside an entry that declares a root namespace,
  typing `$.` offers relative shorthands for that namespace's symbols.

Both features require the `markspec lsp` server to be running. In VS Code,
install the MarkSpec extension — it starts the server automatically.

---

## Common diagnostics and fixes

### TYPL-005 — undefined typedef reference

```
TYPL-005: Reference to undefined typedef Track.
```

**Cause:** A binding uses `Track` as a ref shape, but no `type Track = …`
declaration exists in the same entry.

**Fix:** Add the typedef before the binding, or replace the ref with an inline
shape.

### TYPL-002 / TYPL-003 — cross-entry collisions (deprecated)

`TYPL-002` (kind collision) and `TYPL-003` (shape collision) are **retired** and
never emitted. Under the published tier, two entries that declare the same plain
`$Name` are independent entry-local symbols, so there is no cross-entry
consistency rule for plain names. Corpus-wide agreement is now enforced only for
published (dotted) symbols — see TYPL-009 below.

### TYPL-009 — duplicate published declaration

```
TYPL-009: $powertrain.brake.pedal_position is already declared in icd/brake.md:12 (published symbols are declared exactly once).
```

**Cause:** A published (dotted) symbol is declared in more than one place. A
published symbol must be declared exactly once across the whole project.

**Fix:** Keep the single authoritative declaration and cite it from the other
entries by its full dotted path.

### TYPL-010 — relative reference with no base

```
TYPL-010: Relative reference $.pedal_position has no namespace base in scope.
```

**Cause:** A `$.` relative reference appears with no enclosing `namespace`
declaration and no entry root namespace to resolve against.

**Fix:** Declare a namespace in scope (`` `$powertrain.brake : namespace` ``),
or write the reference as an absolute dotted path.

### TYPL-011 — citation of an undeclared published symbol

```
TYPL-011: Citation of undeclared published symbol $powertrain.brake.pedal_position.
```

**Cause:** An entry cites a dotted published symbol that is never declared
anywhere in the project.

**Fix:** Declare the symbol in its owning entry, or correct the dotted path in
the citation.

### TYPL-012 — multiple root namespaces in one entry

```
TYPL-012: Multiple root namespace declarations in one entry (root is $powertrain.brake).
```

**Cause:** An entry declares more than one top-level `namespace`. An entry may
have at most one root namespace.

**Fix:** Keep a single root namespace; nest the others beneath it, or move them
to their own entries.

### TYPL-001 — duplicate binding in the same entry

```
TYPL-001: Duplicate binding for $Speed in the same entry (first wins, this is a duplicate).
```

**Cause:** The same `$Name` binding appears twice within one entry (across any
mix of surfaces).

**Fix:** Remove the duplicate. The first declaration wins.

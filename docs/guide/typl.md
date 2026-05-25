# Using typl to declare identifier types

typl is the MarkSpec Type Specification DSL. It gives meaning to the `$Name`
tokens that appear in your entry bodies — by declaring their kind (signal,
command, event, …) and their shape (float range, record, enum, …).

---

## When do I use typl?

Use typl when an entry references `$Name` identifiers that represent typed
quantities, and you want:

- **Tooling support** — LSP hover shows the kind and shape of `$Name`; the
  compiler reports undefined references and cross-entry collisions.
- **Downstream codegen** — the `typeRegistry` in
  `markspec compile --format json` maps each identifier to its shape, ready for
  RIDL emitters or custom scripts.
- **Verification clarity** — a tester reading the requirement sees exactly what
  type and range `$Speed` carries, without hunting through other documents.

You do not need typl if your entry bodies contain no `$Name` identifiers, or if
the identifiers are self-explanatory from prose context alone.

---

## Which surface should I use?

Three Markdown surfaces are available. Choose based on how many declarations you
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

All three surfaces share the same namespace within an entry. You can open a
fence for typedefs, then use bullets for bindings, or vice versa. The compiler
merges them.

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

- **Hover** — hovering over a `$Name` token shows its kind, shape, and which
  entry declared it.
- **Completion** — inside a `typl` fence or after `$`, the LSP offers names
  already declared in the workspace as completion candidates.

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

### TYPL-002 — kind collision across entries

```
TYPL-002: $Speed is declared as kind signal here and kind value in SYS_CTRL_0001:14.
```

**Cause:** Two entries declare `$Speed` with different kind keywords.

**Fix:** Align the kind declaration across all entries that use `$Speed`. If the
identifiers are genuinely different quantities, rename one of them.

### TYPL-003 — shape collision across entries

```
TYPL-003: $Speed is declared with a different shape than in SYS_CTRL_0001:14.
```

**Cause:** Two entries agree on the kind but use a different shape for `$Speed`
(e.g., `float[0..300]` in one entry, `float[0..200]` in another).

**Fix:** Decide which shape is authoritative and update the other entry. If both
ranges are intentional, use distinct names.

### TYPL-001 — duplicate binding in the same entry

```
TYPL-001: Duplicate binding for $Speed in the same entry (first wins, this is a duplicate).
```

**Cause:** The same `$Name` binding appears twice within one entry (across any
mix of surfaces).

**Fix:** Remove the duplicate. The first declaration wins.

---

## See also

- [Language reference: typl](../spec/language/typl.md)
- [ADR-019 — typl: Type Specification DSL](../architecture/adr-019-typl-type-dsl.md)

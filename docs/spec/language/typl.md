# typl — Type Specification DSL

typl is the MarkSpec Type Specification DSL. It declares what `$Name`
identifiers mean inside an entry's body — their kind (signal, event, command, …)
and their shape (float range, record, enum, …). Every `$Name` token that appears
in an entry body may be given a typl binding; the compiler collects all bindings
into a per-entry `types` object and a corpus-level `typeRegistry` for downstream
tooling such as codegen and LSP hover.

---

## Statement forms

typl has exactly two statement forms.

### Binding

```
$Name : [kind] shape
```

Declares what `$Name` represents. The kind keyword is optional and defaults to
`value` when omitted.

```
$Speed   : signal float[0..300]
$Enabled : bool
$Idle    : state
```

### Typedef

```
type Name = shape
```

Declares a named shape that bindings in the same entry can reference by name.

```
type Track = { id: int, range_m: float[0..300], velocity_ms: float }
$CurrentTrack : signal Track
```

---

## Kind vocabulary

The kind vocabulary is closed. Nine keywords are defined:

| Kind       | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| `value`    | A plain data value with no lifecycle semantics. Default when omitted. |
| `event`    | A named occurrence, optionally carrying a payload.                    |
| `signal`   | A continuously observable quantity with a measurable shape.           |
| `command`  | A request to perform an action, optionally with parameters.           |
| `state`    | A named mode or state-machine state.                                  |
| `const`    | A named constant whose value does not change at runtime.              |
| `config`   | A configuration parameter supplied before system start.               |
| `document` | A structured artefact (log record, report, notification).             |
| `stream`   | A sequence of values produced over time.                              |

---

## Shape grammar

A shape describes the type of the data carried by a binding. Ten shape variants
are available.

### `primitive`

One of the five built-in primitive types. No constraints.

```
$Enabled  : bool
$Payload  : bytes
$Label    : string
$Counter  : int
$Ratio    : float
```

Primitive names: `int`, `float`, `bool`, `string`, `bytes`.

### `range`

A numeric primitive with min/max bounds or an exact value.

```
$Speed    : signal float[0..300]
$Throttle : signal float[0..1.0]
$Status   : int[0..255]
$Magic    : const int[42]
```

Syntax: `int[min..max]`, `float[min..max]`, `int[exact]`, `float[exact]`. Either
bound may be omitted (`int[0..]`, `int[..255]`).

### `length`

A `string` or `bytes` with a constrained length.

```
$Code    : string[3..6]
$Hash    : bytes[32]
$Prefix  : string[..8]
```

Syntax: `string[min..max]`, `string[exact]`, `bytes[min..max]`, `bytes[exact]`.

### `pattern`

A `string` constrained to a regular expression.

```
$CountryCode : pattern /^[A-Z]{3}$/
$Ident       : pattern /^[a-z_][a-z0-9_]*$/i
```

Syntax: `/regex/` or `/regex/flags`. Supported flags: `i` (case-insensitive).

### `array`

An element shape repeated zero or more times, with optional length bounds.

```
$Readings  : int[]
$Track     : signal float[](..8)
$Waypoints : float[](1..64)
$Matrix3x3 : float[4](9)
```

Syntax: `element[]`, `element[](min..max)`, `element[](exact)`. The element
itself may be any shape, including a ranged type (`float[0..300][]`).

### `enum`

A closed set of string or numeric literals.

```
$Priority : 'low' | 'mid' | 'high'
$State    : 0 | 1 | 2
$Toggle   : true | false
```

Syntax: `literal | literal | …`. String literals use single quotes.

### `record`

A structured object with named fields.

```
type Track = { id: int, range_m: float[0..300], velocity_ms: float }
type Log   = { ts: int, level: 'info' | 'warn' | 'error', msg: string }
```

Syntax: `{ field: shape, field: shape, … }`. Fields are comma-separated. Field
values may be any shape, including nested records and refs.

### `literal`

A single fixed value.

```
$MaxRetries : const int[3]
$Version    : const '1.0'
$Debug      : const true
```

Literals are the `exact` form of `range`, `length`, or bare `true`/`false`. In
practice, `int[3]` and `'fixed'` are the most common literal forms.

### `ref`

A bare PascalCase name referencing a typedef in the same entry.

```
type ErrorCode = int[0..127]
$LastError : signal ErrorCode
```

Syntax: a PascalCase identifier with no punctuation. The name must resolve to a
typedef declared in the same entry (entry-local scope — see §Scope).

### `optional`

A shape that may be absent.

```
$Timestamp : int?
$Metadata  : string?
$Extra     : bytes[32]?
```

Syntax: any shape followed by `?`. Optional wraps the innermost shape:
`float[0..1.0]?` is valid.

---

## Markdown surfaces

typl declarations may appear in three Markdown surfaces. All three parse to the
same Shape AST.

### Fence block

Use a fenced code block tagged `typl` when an entry carries several bindings or
typedefs. The fence collects related declarations visually.

````markdown
- [SYS_RADAR_0012] Radar track output format

  The sensor fusion module shall publish one `$Track` record per tracked object
  at every 100 ms cycle.

  ```typl
  type Track = { id: int, range_m: float[0..300], velocity_ms: float }
  $Track   : signal Track
  $CycleHz : const int[10]
  ```

      Id: 01JZEXAMPLEULID000000000001
      Satisfies: STK_RADAR_0001
````

### Bullet glossary

Use a bullet item with the form `- $Name : …` inside an existing bulleted list
to annotate sparse identifiers. The bullet surface reads naturally as a glossary
note.

```markdown
- [SRS_BRAKE_0030] Brake pedal debounce

  The brake controller shall debounce raw pedal readings over a configurable
  `$Window` millisecond sliding window before emitting `$Stable`.

  - $Window : config int[1..50]
  - $Stable : signal bool

    Id: 01JZEXAMPLEULID000000000002
```

### Inline span

Use a backtick span of the form `` `$Name : …` `` to annotate a single
identifier in-prose without interrupting the surrounding text.

```markdown
- [SRS_CTRL_0005] Gain scheduling

  The controller shall select a gain `$Gain : signal float[0.5..2.0]` based on
  the current operating mode.

      Id: 01JZEXAMPLEULID000000000003
```

---

## Scope

In v1, typl declarations are **entry-local**. A typedef declared in one entry
cannot be referenced by name from a different entry. Cross-entry type sharing is
deferred to a future profile-level scope mechanism.

Within a single entry, all surfaces (fence, bullet, inline) share one namespace.
A `$Name` binding or `type Name` declared in one surface is visible to the
others in the same entry.

---

## Diagnostic catalogue

| Code     | Severity | Description                                                              |
| -------- | -------- | ------------------------------------------------------------------------ |
| TYPL-001 | error    | Duplicate `$Name` binding within the same entry — first occurrence wins. |
| TYPL-002 | error    | Same `$Name` declared with a different kind in another entry.            |
| TYPL-003 | error    | Same `$Name` declared with a different shape in another entry.           |
| TYPL-004 | error    | Typedef name redefined within the same entry.                            |
| TYPL-005 | error    | Reference to an undefined typedef name.                                  |
| TYPL-006 | error    | Malformed schema — unparseable shape expression.                         |
| TYPL-007 | error    | Unknown kind keyword; expected one of the nine closed-vocabulary kinds.  |
| TYPL-008 | error    | Literal value violates the declared constraint.                          |

---

## See also

- [ADR-019 — typl: Type Specification DSL](../../architecture/adr-019-typl-type-dsl.md)
- [Guide: Using typl in your entries](../../guide/typl.md)

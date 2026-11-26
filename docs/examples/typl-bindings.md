# typl Bindings Showcase

This document demonstrates realistic typl declarations across the three
Markdown surfaces: fence, bullet glossary, and inline span. Each entry
is drawn from an automotive context to show how the DSL integrates with
genuine traceability requirements.

---

## Fence surface — radar tracking

The fence surface is the natural choice when an entry carries several
identifiers and at least one reusable typedef. Grouping declarations
in a fence keeps the prose body uncluttered and lets the reader scan
all bindings at a glance.

- [SYS_RADAR_0012] Radar object-track output format

  The sensor fusion module shall publish one `$Track` record per tracked
  object at every `$CycleHz` Hz update rate. Records shall contain an object
  identifier, range in metres, and closing velocity in metres per second.

  ```typl
  type Track = { id: int, range_m: float[0..300], velocity_ms: float[-100..100] }
  $Track   : signal Track
  $CycleHz : const int[10]
  ```

      Id: 01KSS2PGSNGHDT7BJP3JKVRXCV
      Satisfies: STK_RADAR_0001
      Labels: ASIL-B

---

## Bullet surface — brake controller

The bullet glossary surface suits entries whose body already contains
a list, or where the set of identifiers is small and naming them inline
would clutter the prose. The `- $Name : kind shape` bullet sits cleanly
at the same indent level as any other list item.

- [SRS_BRAKE_0030] Brake-pedal signal debounce

  The brake controller shall debounce raw pedal readings over a `$Window`
  millisecond sliding window before emitting the `$Stable` output signal.
  The debounce window shall be configurable at system-start time and shall
  not exceed 50 ms.

  ```typl
  $Window : config int[1..50]
  $Stable : signal bool
  ```

      Id: 01KSS2PGSNKD8XGJA3RP4KCXJW
      Satisfies: STK_BRAKE_0002
      Labels: ASIL-C

---

## Inline surface — controller gain scheduling

The inline backtick span is the lightest surface: one identifier
declared directly in the sentence that mentions it. Use this when
the prose would read oddly with a separate list or fence, and there is
only one or two identifiers to annotate.

- [SRS_CTRL_0005] Gain scheduling output

  The controller shall apply a longitudinal gain
  `$Gain : signal float[0.5..2.0]` selected from the active gain table
  based on the current velocity operating mode. The gain selection shall
  complete within one control cycle of an operating-mode transition.

      Id: 01KSS2PGSN15WMYG2H2K8P5RQ0
      Satisfies: SYS_CTRL_0003
      Labels: ASIL-B

---

## Mixed surfaces — diagnostic logging

When a single entry needs a shared typedef (best expressed in a fence)
alongside a few per-signal annotations (comfortable as bullets), the
two surfaces may coexist. All declarations in an entry share one
namespace regardless of which surface introduces them.

- [SYS_LOG_0004] Fault diagnostic record

  The system shall emit a `$FaultRecord` document to the diagnostic bus
  whenever a monitored fault is detected, and shall maintain a rolling
  `$FaultRate` signal representing faults per second over a 10-second
  window.

  ```typl
  type Severity  = 'info' | 'warn' | 'error' | 'fatal'
  type FaultRecord = { ts: int, severity: Severity, code: int[0..255], msg: string[..128] }
  ```

  ```typl
  $FaultRecord : document FaultRecord
  $FaultRate   : signal float[0..100]
  ```

      Id: 01KSS2PGSNA58HXQ4HAQVNZ43W
      Satisfies: STK_DIAG_0001
      Labels: QM

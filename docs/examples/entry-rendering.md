# Entry Rendering Showcase

This document demonstrates the admonition-style rendering for entries under a
sample compliance profile, with label pills and cross-reference links. Each
entry's type (requirement, test, architecture, standard, dependency, …) is
inferred by the active profile from the display-ID prefix — no `type:`
attribute is written in source. Cross-reference relation names (`Satisfies`,
`Verifies`, `Derived-from`) are likewise profile-declared.

## Requirements (req — blue)

- [STK_AEB_0001] Emergency braking activation

  The system shall initiate autonomous emergency braking when time-to-collision
  falls below the configurable threshold and the driver has not applied the
  brake pedal.

  ```feature
  Scenario: Noise spike shorter than debounce window
    Given a debounce window of 10ms
    And a stable pressure reading of 500
    When a spike of 999 occurs for 5ms
    Then the output shall remain 500

  Scenario: Sustained change longer than debounce window
    Given a debounce window of 10ms
    And a stable pressure reading of 500
    When the reading changes to 600 for 15ms
    Then the output shall change to 600
  ```

      Id: 01HGW3A2BCD5VWXYZABCDEFGHJ
      Labels: ASIL-B, Labels: safety-critical

- [SYS_AEB_0012] Object threat assessment from radar tracks

  The system shall compute a threat level for each tracked object based on
  time-to-collision, relative velocity, and object classification.

      Id: 01HGW3C4DEF6VWXYZABCDEFGHJ
      Satisfies: STK_AEB_0001
      Labels: ASIL-B


- [SWE_BRK_0107] Median filter implementation

  The braking ECU shall apply a 5-sample median filter to the raw brake pressure
  sensor input before processing.  $aNiceVariable


      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: SYS_AEB_0012
      Labels: ASIL-B, real-time, performance

Prose between entries renders normally — no left border, no type coloring. The
visual separation between entries and prose is provided by the admonition border
alone.

## Architecture (spec — green)

- [SAD_AEB_0001] Perception–decision pipeline

  The AEB system architecture separates perception (sensor fusion, object
  tracking) from decision (threat assessment, braking command) via a
  publish-subscribe message bus.

      Id: 01HGW4E5GHJ7VWXYZABCDEFGHJ
      Satisfies: STK_AEB_0001

- [ICD_AEB_0010] Radar frame interface

  The radar driver shall publish `RadarFrame` messages at 20 Hz containing
  range, velocity, azimuth, and classification for each detected object.

      Id: 01HGW4F6HKM8VWXYZABCDEFGHJ
      Satisfies: SAD_AEB_0001
      Labels: interface

## Verification (test — red)

- [SWT_AEB_0030] Time-to-collision unit test

  Verify that `compute_ttc(range, velocity)` returns the correct ratio for
  positive closing velocity and returns infinity for zero or negative closing
  velocity.

      Id: 01HGW5G7JMN9VWXYZABCDEFGHJ
      Verifies: SWE_BRK_0107

- [SIT_AEB_0012] Perception-to-decision integration

  Verify end-to-end that a radar frame with a stationary object at 40m produces
  a `High` threat level through the full perception–decision pipeline.

      Id: 01HGW5H8KPQ0VWXYZABCDEFGHJ
      Verifies: SYS_AEB_0012
      Labels: integration

## Edge cases

Entry with no labels — pill group is not rendered:

- [SRS_BRK_0200] Brake pressure sensor range check

  The braking ECU shall reject brake pressure readings outside the valid sensor
  range [0, 250] bar.

      Id: 01HGW6J9NRS1VWXYZABCDEFGHJ
      Satisfies: SYS_AEB_0012

Entry with many labels — pill group wraps to the next line:

- [SRS_BRK_0201] Sensor fault detection

  The braking ECU shall detect open-circuit, short-circuit, and out-of-range
  faults on all brake pressure sensors within one sample period.

      Id: 01HGW6K0MST2VWXYZABCDEFGHJ
      Satisfies: SYS_AEB_0012
      Labels: ASIL-B
      Labels: safety-critical
      Labels: real-time
      Labels: performance
      Labels: diagnostics
      Labels: fault-tolerance

Entry with multiple cross-references:

- [SRS_BRK_0202] Redundant sensor voting

  The braking ECU shall use triple-modular redundancy voting across the three
  brake pressure sensors.

      Id: 01HGW6N1NVW3VWXYZABCDEFGHJ
      Satisfies: SYS_AEB_0012
      Derived-from: STK_AEB_0001
      Labels: ASIL-B
      Labels: redundancy

## Referenced entries

Citations of external standards are **referenced entries** — their `Id:` is a
URI, and the display ID serves as a pandoc-style slug:

- [@ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Software level.

      Id: urn:iso:std:iso:26262:-6:ed-2
      Labels: functional-safety
      Labels: automotive

- [serde] serde Rust serialization framework

      Id: pkg:cargo/serde@1.0.0
      Labels: dependency
      Labels: open-source

## EARS patterns and modal verbs

Five entries showing the five EARS patterns. The EARS trigger word
(`When` / `While` / `If` / `Where`) and the modal verb (`shall`,
`should`, `may`, `must`, `will`) both render as `keyword` tokens —
strong/bold on every theme. Negated forms like `shall not` highlight
only the modal.

- [STK_AEB_0010] Continuous self-diagnostics (Ubiquitous)

  The brake system shall perform continuous self-diagnostics whenever the
  vehicle ignition is on. The vehicle must report any detected anomaly to
  the driver instrument cluster within 500 ms.

      Id: 01HGW7A1BCDE2VWXYZABCDEFGH
      Satisfies: STK_AEB_0001
      Labels: ASIL-B

- [STK_AEB_0011] Brake response on pedal press (Event-driven)

  When the driver presses the brake pedal, the system shall reduce engine
  torque within 50 ms. When the driver releases the pedal, engine torque
  may return to the requested level over the next 100 ms.

      Id: 01HGW7B2DEFG3VWXYZABCDEFGH
      Satisfies: STK_AEB_0001
      Labels: ASIL-B

- [STK_AEB_0012] Sensor monitoring in autonomous mode (State-driven)

  While the vehicle is in autonomous mode, the system shall continuously
  monitor sensor health and report degraded sensors. While a sensor is
  flagged degraded, the decision module should de-weight its contribution
  to the fusion output.

      Id: 01HGW7C3FGHJ4VWXYZABCDEFGH
      Satisfies: STK_AEB_0001
      Labels: ASIL-B

- [STK_AEB_0013] Optional automatic emergency braking (Optional)

  Where automatic emergency braking is enabled by the driver, the system
  shall compute time-to-collision for each tracked object on every radar
  frame. Where the driver has disabled the feature, the system will
  continue object tracking without engaging the brakes.

      Id: 01HGW7D4GHJK5VWXYZABCDEFGH
      Satisfies: STK_AEB_0001
      Labels: ASIL-B

- [STK_AEB_0014] Fault recovery (Unwanted)

  If a primary radar fails, then the system shall switch to degraded mode
  within one diagnostic cycle. The system shall not engage automatic
  braking while in degraded mode.

      Id: 01HGW7E5HJKL6VWXYZABCDEFGH
      Satisfies: STK_AEB_0001
      Labels: ASIL-B
      Labels: fault-tolerance

## Entity references and code blocks

Entity references use the `$Identifier` syntax — three case conventions
distinguish their domain:

- `$TypeName` (PascalCase) → type / class reference
- `$instanceName` (camelCase) → instance / variable reference
- `$CONSTANT_NAME` (SCREAMING_SNAKE) → constant reference

- [SWE_BRK_0210] Median filter scaffolding

  The braking ECU shall apply $MedianFilter to $rawPressure samples with
  window size $WINDOW_SIZE. The filtered output feeds $brakeDecision on
  every cycle.

  ```rust
  use crate::filter::MedianFilter;

  pub fn filter_pressure(raw: &[f32]) -> Vec<f32> {
      let filter = MedianFilter::new(5);
      raw.iter().map(|&x| filter.next(x)).collect()
  }
  ```

  Below the code block: $rawPressure and $MedianFilter remain entity
  refs because the language fence is `rust`, not `feature`.

      Id: 01HGW8F6JKLM7VWXYZABCDEFGH
      Satisfies: SYS_AEB_0012
      Labels: ASIL-B
      Labels: performance

- [SWE_BRK_0211] Gherkin scenarios for the filter

  The implementation shall pass the acceptance criteria expressed as
  Gherkin scenarios:

  ```feature
  Feature: Median filter debouncing
    Background:
      Given a window size of 5

    Scenario: Spike shorter than the window
      Given a stable reading of 500
      When a spike of 999 occurs for 2 samples
      Then the output shall remain 500

    Scenario Outline: Window size sensitivity
      Given a window size of <window>
      When the input changes from 500 to 600 over <samples> samples
      Then the output shall be <result>
      Examples:
        | window | samples | result |
        | 3      | 1       | 500    |
        | 3      | 3       | 600    |
        | 5      | 3       | 500    |
  ```

      Id: 01HGW8G7KLMN8VWXYZABCDEFGH
      Verifies: SWE_BRK_0210
      Labels: integration

## Tables and math

Tables render as standard Markdown tables. Entity references inside
table cells still get highlighted; the trailer block sits below the
table and dims as usual.

- [SAD_AEB_0030] AEB decision-module parameters

  The decision module computes braking thresholds from the parameters
  below. $T_threshold gates the transition from `Low` to `High` threat.

  | Parameter         | Symbol        | Range      | Source            |
  | ----------------- | ------------- | ---------- | ----------------- |
  | Closing velocity  | v_c           | 0–120 km/h | $closingVelocity  |
  | Time-to-collision | T_TTC         | 0–5 s      | $TTC formula      |
  | Brake threshold   | T_brake       | 0.5–2.0 s  | $BRAKE_THRESHOLD  |
  | Sensor period     | $samplePeriod | 50 ms      | radar driver      |

  Table: AEB decision-module input parameters.

  The time-to-collision is defined by:

  $$
  T_{TTC} = \frac{\text{range}}{\text{closing velocity}}
  $$

  When $T_{TTC}$ falls below $BRAKE_THRESHOLD, the system shall command
  full braking. The math fence `$$ … $$` is recognised — identifiers
  inside the fence are not tokenised as entity references. (Inline
  single-`$` math such as `$T_{TTC}$` is not currently distinguished
  from entity refs; the body-token AST refactor will address that.)

      Id: 01HGW9H8MNOP9VWXYZABCDEFGH
      Satisfies: SYS_AEB_0012
      Labels: design

## Admonitions and blockquotes

GitHub-flavoured Markdown admonitions (`> [!NOTE]`, `> [!TIP]`,
`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) and plain
blockquotes (`> …`) are part of the spec but currently receive no
LSP-side visual treatment beyond VS Code's built-in Markdown grammar
(which renders `>` and `[!NOTE]` as muted block-quote chrome). The
admonition cards you may have seen in PDF / book / preview renderers
are produced by the Typst / HTML downstreams, not by the source-view
LSP.

- [SRS_BRK_0220] Sensor watchdog timeout

  The braking ECU shall trigger a watchdog reset if the radar driver
  publishes no `RadarFrame` for $WATCHDOG_TIMEOUT_MS milliseconds.

  > [!NOTE]
  > The watchdog timeout must be at least twice the publish period to
  > avoid false triggers during transient bus contention.

  > [!WARNING]
  > Disabling the watchdog (via the `--no-watchdog` build flag) is
  > only permitted on bench rigs; production builds must keep it
  > enabled.

  > A plain blockquote — no `[!KIND]` marker. The `shall` inside this
  > quote still gets keyword-tokenised by the body scanner; same for
  > modal verbs and EARS triggers inside `[!NOTE]` / `[!WARNING]`
  > content above.

      Id: 01HGWAI9NPRS0VWXYZABCDEFGH
      Satisfies: SYS_AEB_0012
      Labels: ASIL-B
      Labels: fault-tolerance

- [SRS_BRK_0221] Brake actuator interface

  > [!IMPORTANT]
  > The actuator interface uses CAN frame ID `0x18FF50E5` (J1939
  > priority 6). The braking ECU shall publish frames at 100 Hz when
  > a brake demand is active, and may drop the rate to 10 Hz when no
  > demand is pending.

  The CAN driver delivers each frame to `$BrakeActuator` via the
  publish-subscribe bus.

      Id: 01HGWAJ0OQRT1VWXYZABCDEFGH
      Satisfies: SAD_AEB_0001
      Labels: interface


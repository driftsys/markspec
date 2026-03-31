# Entry Rendering Showcase

This document demonstrates the admonition-style rendering for all entry types,
label pills, and cross-reference links.

## Requirements (req — blue)

- [STK_AEB_0001] Emergency braking activation

  The system shall initiate autonomous emergency braking when time-to-collision
  falls below the configurable threshold and the driver has not applied the
  brake pedal.

  Id: STK_01HGW3A2BCD5\
  Labels: ASIL-B, safety-critical

- [SYS_AEB_0012] Object threat assessment from radar tracks

  The system shall compute a threat level for each tracked object based on
  time-to-collision, relative velocity, and object classification.

  Id: SYS_01HGW3C4DEF6\
  Satisfies: STK_AEB_0001\
  Labels: ASIL-B

- [SWE_BRK_0107] Median filter implementation

  The braking ECU shall apply a 5-sample median filter to the raw brake pressure
  sensor input before processing.

  Id: SWE_01HGW2Q8MNP3\
  Satisfies: SYS_AEB_0012\
  Labels: ASIL-B, real-time, performance

Prose between entries renders normally — no left border, no type coloring. The
visual separation between entries and prose is provided by the admonition border
alone.

## Architecture (spec — green)

- [SAD_AEB_0001] Perception–decision pipeline

  The AEB system architecture separates perception (sensor fusion, object
  tracking) from decision (threat assessment, braking command) via a
  publish-subscribe message bus.

  Id: SAD_01HGW4E5GHJ7\
  Satisfies: STK_AEB_0001

- [ICD_AEB_0010] Radar frame interface

  The radar driver shall publish `RadarFrame` messages at 20 Hz containing
  range, velocity, azimuth, and classification for each detected object.

  Id: ICD_01HGW4F6HKL8\
  Satisfies: SAD_AEB_0001\
  Labels: interface

## Verification (test — red)

- [SWT_AEB_0030] Time-to-collision unit test

  Verify that `compute_ttc(range, velocity)` returns the correct ratio for
  positive closing velocity and returns infinity for zero or negative closing
  velocity.

  Id: SWT_01HGW5G7JMN9\
  Verifies: SWE_BRK_0107

- [SIT_AEB_0012] Perception-to-decision integration

  Verify end-to-end that a radar frame with a stationary object at 40m produces
  a `High` threat level through the full perception–decision pipeline.

  Id: SIT_01HGW5H8KPQ0\
  Verifies: SYS_AEB_0012\
  Labels: integration

## Edge cases

Entry with no labels — pill group is not rendered:

- [SRS_BRK_0200] Brake pressure sensor range check

  The braking ECU shall reject brake pressure readings outside the valid sensor
  range [0, 250] bar.

  Id: SRS_01HGW6J9LRS1\
  Satisfies: SYS_AEB_0012

Entry with many labels — pill group wraps to the next line:

- [SRS_BRK_0201] Sensor fault detection

  The braking ECU shall detect open-circuit, short-circuit, and out-of-range
  faults on all brake pressure sensors within one sample period.

  Id: SRS_01HGW6K0MST2\
  Satisfies: SYS_AEB_0012\
  Labels: ASIL-B, safety-critical, real-time, performance, diagnostics, fault-tolerance

Entry with multiple cross-references:

- [SRS_BRK_0202] Redundant sensor voting

  The braking ECU shall use triple-modular redundancy voting across the three
  brake pressure sensors.

  Id: SRS_01HGW6L1NUV3\
  Satisfies: SYS_AEB_0012\
  Derived-from: STK_AEB_0001\
  Labels: ASIL-B, redundancy

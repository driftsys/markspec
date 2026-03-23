# ADR-NNN: Title

<!-- Replace NNN with the next sequential number.
     Title should be a short noun phrase: "Message broker selection",
     "Authentication strategy", "Sensor data pipeline". -->

## Context

<!-- What problem or need motivates this decision? Include constraints,
     forces, and relevant background. Keep it factual — one or two paragraphs.

     Example: "The braking ECU receives raw sensor data at 1 kHz. The current
     polling architecture cannot meet the 150 ms response time requirement
     under peak load. We need an interrupt-driven pipeline." -->

## Decision

<!-- State the decision, then capture each design choice as a SAD or ICD
     requirement using MarkSpec entry blocks.

     Use SAD for internal architecture decisions.
     Use ICD for interface contracts between components or systems.
     Replace XXX with your project/domain abbreviation (e.g., BRK, NAV, COM).
     Replace NNNN with the next number in your project sequence.
     Leave Id empty — tooling assigns the ULID on commit. -->

- [SAD_XXX_NNNN] Decision title

  <!-- One or two paragraphs describing what the system shall do and why.
       Use "shall" for normative statements.

       Example: "The sensor pipeline shall use an interrupt-driven architecture
       with a lock-free ring buffer to decouple acquisition from processing." -->

  Id:\
  Satisfies:\
  Labels:

  <!-- Id: left empty, assigned by `markspec doc format`.
       Satisfies: upstream requirement ID (e.g., STK_BRK_0001, SYS_BRK_0042).
       Labels: classification tags (e.g., ASIL-B, security, performance).
       Remove unused attributes rather than leaving them blank. -->

<!-- Add more entry blocks as needed. One block per distinct decision point.
     Mix SAD and ICD blocks when the decision spans both internal architecture
     and external interfaces.

- [ICD_XXX_NNNN] Interface title

  Description of the interface contract.

  Id: \
  Satisfies: \
  Labels:

-->

## Alternatives rejected

<!-- List each alternative considered and why it was not chosen.
     One heading per alternative, a short paragraph explaining the reason.

     Example:

### Polling architecture

Simpler to implement but cannot meet the 150 ms latency target under peak
load. Measured worst-case latency of 320 ms in prototype.

### DMA-based pipeline

Meets latency requirements but requires hardware support not available on
all target ECUs. Would limit portability across the product line.

-->

## Consequences

<!-- What changes as a result of this decision? List both positive and
     negative implications. Keep it honest — every decision has trade-offs.

     Example:
     - Interrupt-driven pipeline meets the 150 ms latency target.
     - Ring buffer adds memory overhead (configurable, default 4 KB).
     - Team needs to learn lock-free programming patterns. -->

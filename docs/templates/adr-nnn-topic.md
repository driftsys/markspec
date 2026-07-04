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

Write one entry block per decision point. Use `SAD_` for internal architecture
and `ICD_` for interface contracts; replace `XXX` with your project abbreviation
and `NNNN` with the next number. Leave `Id:` empty — `markspec fmt` stamps the
ULID — and remove attributes you do not use rather than leaving them blank.

```markdown
- [SAD_BRK_0001] Interrupt-driven acquisition pipeline

  The sensor pipeline shall use an interrupt-driven architecture with a
  lock-free ring buffer to decouple acquisition from processing.

      Id:
      Satisfies: STK_BRK_0001
      Labels: ASIL-B
```

<!-- Add more entry blocks as needed. One block per distinct decision point.
     Mix SAD and ICD blocks when the decision spans both internal architecture
     and external interfaces.

- [ICD_XXX_NNNN] Interface title

  Description of the interface contract.

      Id:
      Satisfies:
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

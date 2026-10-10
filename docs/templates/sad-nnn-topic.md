# SAD-NNN: Title

<!-- Replace NNN with the next sequential number.
     Title should name the system or subsystem: "Braking ECU",
     "Telemetry gateway", "Sensor acquisition pipeline". -->

## Context

<!-- What is this system? What problem does it solve? What are the key
     stakeholders and quality goals? Include a context diagram showing the
     system boundary and its neighbours.
     Keep it to one or two paragraphs + a diagram. -->

<!-- ![Context diagram](diagrams/sad-nnn-context.svg) -->

## Architecture

<!-- How is the system built? Include a diagram showing components and
     their relationships. One SAD entry per significant design decision.

     Omit the `Id:` line — `markspec fmt` adds it with a fresh ULID — and
     remove attributes you do not use rather than leaving them blank: a
     trailer line with an empty value (`Id:`, `Satisfies:`) is not a valid
     trailer (`markspec check` reports `MSL-P021`). -->

<!-- ![Architecture diagram](diagrams/sad-nnn-architecture.svg) -->

```markdown
- [SAD_BRK_0001] Lock-free acquisition buffer

  The acquisition module shall use a lock-free ring buffer to decouple sensor
  sampling from processing.

      Satisfies: STK_BRK_0001
      Labels: ASIL-B
```

## Interfaces

<!-- One ICD entry per external interface between the components above.
     Describe protocol, data format, direction, rate, and constraints. -->

```markdown
- [ICD_BRK_0001] Sensor frame publication interface

  The sensor gateway shall expose a CAN 2.0B interface publishing filtered
  sensor frames at 100 Hz.

      Satisfies: SAD_BRK_0001
      Labels: ASIL-B
```

## Constraints

<!-- Non-functional requirements that shape the architecture.
     Each subsection below is mandatory — state the applicable constraints
     or explicitly write "Not applicable" with justification.
     Use SYS_ for system-level constraints, SRS_ for software-level. -->

### Regulation

Not applicable.

<!-- Replace with applicable standards, certifications, compliance requirements.
     Examples: ISO 26262, IEC 61508, DO-178C, AUTOSAR, MISRA, EU MDR.

- [SYS_XXX_NNNN] Regulation constraint

  Description of the regulatory constraint.

      Satisfies: STK_XXX_NNNN
      Labels: LABEL

-->

### Privacy

Not applicable.

<!-- Replace with data protection requirements: GDPR, CCPA, data residency,
     PII handling, retention policies, anonymization, consent management.

- [SYS_XXX_NNNN] Privacy constraint

  Description of the privacy constraint.

      Satisfies: STK_XXX_NNNN
      Labels: LABEL

-->

### Safety

Not applicable.

<!-- Replace with functional safety requirements: ASIL levels, safe states,
     fault detection, degraded modes, watchdog strategies, independence.

- [SYS_XXX_NNNN] Safety constraint

  Description of the safety constraint.

      Satisfies: STK_XXX_NNNN
      Labels: LABEL

-->

### Cybersecurity

Not applicable.

<!-- Replace with security requirements: authentication, encryption,
     secure boot, key management, intrusion detection, update signing.

- [SRS_XXX_NNNN] Cybersecurity constraint

  Description of the cybersecurity constraint.

      Satisfies: SYS_XXX_NNNN
      Labels: LABEL

-->

### Performance and reliability

Not applicable.

<!-- Replace with performance/reliability requirements: latency, throughput,
     availability, MTBF/MTTR, resource budgets, scalability, degradation.

- [SRS_XXX_NNNN] Performance constraint

  Description of the performance or reliability constraint.

      Satisfies: SYS_XXX_NNNN
      Labels: LABEL

-->

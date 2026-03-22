# Traceability Matrix

> [!NOTE]
> This file is a **generated build artifact**. It is never committed to the
> repository. It is produced by `markspec doc validate` from upstream
> declarations in requirements, tests, and code.

| ID             | Requirement               | Implemented-by            | Verified-by    |
| -------------- | ------------------------- | ------------------------- | -------------- |
| `STK_BRK_0001` | Brake response time       | `SYS_BRK_0042`            | `VAL_BRK_0001` |
| `SYS_BRK_0042` | Sensor noise filtering    | `SRS_BRK_0001`            | `SIT_BRK_0042` |
| `SRS_BRK_0001` | Sensor input debouncing   | `braking::debounce_input` | `SWT_BRK_0001` |
| `SRS_BRK_0002` | Sensor plausibility check |                           |                |

Empty cells are gaps. This table is the single view an auditor uses to assess
coverage completeness.

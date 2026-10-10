# Software requirements

- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw obstacle inputs over three consecutive
  samples.

      Id: 01JBRK00000000000000000006
      Satisfies: SYS_BRK_0001

- [SRS_BRK_0002] Sensor plausibility check

  The sensor driver shall reject obstacle readings that change faster than the
  physical limit of the sensor.

      Id: 01JBRK00000000000000000007
      Satisfies: SYS_BRK_0001

- [SWT_BRK_0001] Debounce rejects a single-sample spike

  Feed one high sample between two low samples and expect no obstacle.

      Id: 01JBRK00000000000000000008
      Verifies: SRS_BRK_0001

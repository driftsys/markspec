# System requirements

- [SYS_BRK_0001] Brake response time

  The braking system shall apply full braking torque within 200 ms of a
  confirmed obstacle.

      Id: 01JBRK00000000000000000003
      Satisfies: STK_BRK_0001

- [SYS_BRK_0002] Redundant brake actuation

  The braking system shall apply braking torque through a second, independent
  actuation path when the primary path fails.

      Id: 01JBRK00000000000000000004
      Derived-from: HAZ_BRK_0001
      Satisfies: STK_BRK_0001

- [SIT_BRK_0001] Brake response under a confirmed obstacle

  Inject a confirmed obstacle at 60 km/h and measure the time to full braking
  torque.

      Id: 01JBRK00000000000000000005
      Verifies: SYS_BRK_0001

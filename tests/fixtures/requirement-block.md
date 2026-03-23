# Braking System — Software Requirements

## Sensor Processing

- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  The debounce window shall be configurable per sensor type.

  > [!WARNING]
  > Failure to debounce may lead to spurious brake activation.

  Id: SRS_01HGW2Q8MNP3\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B

- [SRS_BRK_0002] Sensor plausibility check

  The sensor driver shall reject readings outside the physically plausible range
  for each sensor type.

  Id: SRS_01HGW2R9QLP4\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B

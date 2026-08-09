# ADR-013: Machine-Measured Context Values

## Status

Accepted, implementation in progress.

## Decision

PCS distinguishes `user_confirmed` and `machine_measured` values. Machine-measured values are append-only and do not enter the user review queue, but every value must retain `definitionVersion`, `sourceTool`, `sourceToolVersion`, and `measuredAt`.

Profiles exclude machine-measured values by default. A profile must explicitly set `includeMachineMeasured` before those values can appear in the V3 analysis snapshot. Omitted values are counted as `machineMeasuredNotPermitted`.

## Rationale

Measurement provenance and human confirmation are different facts. Treating a measured activity duration as user-confirmed would make the evidence boundary misleading, while silently exporting it would make profile disclosure unpredictable.

## Compatibility

Existing rows are migrated as `user_confirmed`. The V2 snapshot API remains available; V3 carries `confirmationMode` and optional measurement metadata.

## Remaining work

Remeasurement writes, correction of a machine value into a new user-confirmed revision, and cross-repository import adapters are tracked as follow-up implementation work.

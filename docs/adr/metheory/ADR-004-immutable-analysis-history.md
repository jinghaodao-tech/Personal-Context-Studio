# ADR-004: Immutable analysis history

## Context
A new snapshot can change a result and must not erase what a user previously saw.

## Decision
Store `snapshotId`, profile, period, schema version, source IDs, source fingerprint, contract hash, and a compact result summary in `pcs_analysis_runs`. Same snapshot is idempotent; a new snapshot creates a new run.

## Alternatives
Keep only the latest result; update a single row; store only candidate text.

## Consequences
History is auditable and supports staleness checks. Storage grows with analysis runs, so raw records are not duplicated.

## Reversal
Add retention or compaction as a versioned policy, preserving provenance and a timeline event.
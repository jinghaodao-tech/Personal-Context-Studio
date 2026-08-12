# ADR-012: PCS V3 Machine Measurement Boundary

## Context
PCS now provides machine-measured values with explicit confirmation mode and measurement metadata. MeTheory must accept them without representing them as user-confirmed values.

## Decision
MeTheory accepts PCS V2 and V3 snapshots at the analysis boundary. V3 requires metadata for `machine_measured` values and maps their provenance to `system`; `user_confirmed` remains `user_confirmed`.

The adapter in `packages/self-understanding/src/pcsSnapshotAnalysis.ts` explicitly converts validated V3 values into the internal analysis record shape while preserving provenance and `sourceTool`. V2 remains supported for compatibility; V3 is not silently downgraded at ingestion.

## Alternatives

- Treat all V3 values as user-confirmed V2 values.
- Accept V3 only at ingestion and postpone all analysis support.
- Reject machine-measured values until a completely separate analysis engine exists.

The first alternative misrepresents provenance. The latter two would block the reviewed real-data path without adding safety beyond the explicit adapter and existing evidence rules.

## Consequences
The existing candidate engine can analyze both snapshot versions while preserving the distinction between user and machine sources. Same-source machine comparisons can disclose possible measurement-definition confounding. Source-priority behavior for conflicts remains governed by ADR-008.

## Reversal
Introduce a new versioned snapshot adapter and migration policy. Do not remove provenance metadata or reinterpret historical V3 analysis runs.

# ADR-014: Normalize canonical data and denormalize derived read models

## Status

Accepted.

## Context

PCS stores Markdown as the human-readable source of record and SQLite as a derived index. The system also has relationships, imports, snapshots, and read paths that may benefit from precomputed or joined data. Keeping every representation fully normalized would make reads and exports more expensive, while treating denormalized data as canonical would create competing sources of truth.

## Decision

Canonical records and relationships remain normalized at their authoritative boundary. Denormalized projections are allowed only as rebuildable read models, search indexes, snapshots, or import/export payloads.

Every denormalized representation must have an identifiable source, a rebuild or refresh path, and a clear freshness boundary. Writes must update the canonical representation first; derived data must never silently become authoritative.

## Alternatives

- Fully normalize every read path: rejected because repeated joins and reconstruction would make local reads and exports unnecessarily costly.
- Make denormalized records authoritative: rejected because duplicated fields can diverge and provenance becomes ambiguous.
- Allow ad hoc duplication without metadata: rejected because stale data could be mistaken for confirmed context.

## Consequences

- Canonical data has one ownership boundary and can be validated independently.
- Search and snapshot consumers can use efficient denormalized data without changing the source of truth.
- Rebuild, freshness, and failure behavior must be tested for every derived representation.
- A stale derived index may affect availability or search freshness, but it must not rewrite or overwrite canonical Markdown or confirmed records.

## Reversal

Revisit this decision if profiling shows that the normalized canonical boundary is the dominant cost, or if a future storage adapter can provide equivalent provenance, rebuildability, and consistency guarantees.

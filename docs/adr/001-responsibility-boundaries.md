# ADR-001: Responsibility Boundaries

## Decision

PCS owns human-readable Markdown, structured-value review, sharing policy, privacy operations, and integration contracts. The API route layer only translates HTTP requests; lifecycle, export, migration, and integration behavior must remain testable through services or repository boundaries.

MeTheory owns non-diagnostic analysis of approved PCS snapshots. It does not copy PCS records into its own source of truth.

## Consequences

- `context_value_revisions`, provenance, and audit records remain append-only.
- Integration clients receive only purpose/profile-scoped snapshots.
- Search and analysis results are rebuildable derivatives.
- Cross-repository behavior is verified by contract and live E2E tests.

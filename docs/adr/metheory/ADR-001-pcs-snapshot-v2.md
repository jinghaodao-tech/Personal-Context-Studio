# ADR-001: PCS Snapshot V2 as the analysis boundary

## Context
MeTheory must analyze structured data without owning the Markdown editing experience.

## Decision
Use a strict, versioned `pcs-analysis-snapshot-v2` contract at the API boundary,
with contract revision `pcs-analysis-snapshot-v2.1`. The snapshot carries only
user-confirmed, permitted values plus provenance and exclusions.

## Alternatives
Read PCS SQLite tables directly; import Markdown into MeTheory; use an unversioned JSON object.

## Consequences
PCS and MeTheory remain independently deployable. Contract validation is required before analysis and new versions can be introduced without silent reinterpretation.

## Reversal
Add a new adapter and contract version; do not loosen V2 validation in place.
V1 is compatibility-only and is not used by the primary analysis flow.

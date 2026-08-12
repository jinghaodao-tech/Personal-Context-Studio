# ADR-010: The official PCS package owns the analysis contract

## Context
The PCS analysis snapshot is shared across repositories. A duplicated local schema can drift from the contract used by Personal Context Studio.

## Decision
The installed `personal-context-studio/integration-contracts` package is the single source of truth for the PCS analysis snapshot shape, schema version, and contract revision. MeTheory imports its runtime validator and version constants at the API and analysis boundaries.

The former `schemas/pcs-analysis-snapshot-v2.schema.json` was removed because it duplicated part of the wire contract and was not used by the runtime or verification scripts. Fixtures may contain concrete snapshot examples, but they are validated through the official package.

## Alternatives

- Keep a second local JSON schema in MeTheory.
- Generate the contract independently in each repository.
- Accept unversioned JSON and validate fields opportunistically.

These alternatives were rejected because they permit contract drift or silent reinterpretation.

## Consequences
Contract changes are coordinated through the official package and its locked dependency version. Runtime and verification use the same validator, while fixtures remain useful as concrete examples.

## Reversal
Adopt a new versioned contract authority and migrate both repositories together. Do not reintroduce an unmanaged duplicate schema.

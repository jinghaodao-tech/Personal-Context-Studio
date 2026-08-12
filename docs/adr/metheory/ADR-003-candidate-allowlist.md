# ADR-003: Explicit candidate pair allowlist

## Context
Free-form labels are not sufficient evidence of a valid semantic comparison.

## Decision
Candidate generation on the PCS path requires a versioned allowlist and an
explicit condition/outcome role pair. `candidate-pair-v1` remains available
for existing analyses; `candidate-pair-v2` adds machine-measurement pairs and
the derived `time_of_day -> focus` comparison. Unknown, unconfirmed, excluded,
or incompatible fields are omitted with a visible reason.

## Alternatives
Infer roles from labels; compare every pair; let an AI choose pairs.

## Consequences
Fewer candidates, but each candidate is explainable and reproducible.

## Reversal
Publish a new allowlist version with tests and a data review; never change the meaning of an old version.

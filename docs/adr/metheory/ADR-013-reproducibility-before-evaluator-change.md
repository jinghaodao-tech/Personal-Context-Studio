# ADR-013: Preserve the evaluator until independent replication

## Context

The real PCS analysis period was inspected repeatedly while candidate pairs, cohort handling, period selection, and effect presentation were being developed. Changing the evaluator after inspecting the same discovery data would make the reported result difficult to reproduce and would mix discovery with validation.

## Decision

Do not change the evaluator thresholds, candidate semantics, or significance interpretation solely to improve the current discovery result. Keep the current deterministic evaluator and treat the existing result as discovery evidence. Any proposed evaluator change must be versioned and evaluated on an independent period, with the original result preserved for comparison.

The current analysis may still expose descriptive robustness diagnostics, such as ratios, stratification, and correlations, but those diagnostics do not retroactively turn the discovery period into validation or replication.

## Consequences

- The current result may remain insufficient or inconclusive without being tuned to produce a candidate.
- Future data from a non-overlapping period can test whether the direction is reproduced.
- A later evaluator revision can be compared against the preserved baseline instead of replacing it silently.

## Reversal

Revisit this decision only after an independent replication period or a separately versioned methodological review demonstrates that the current evaluator is invalid for a defined class of measurements.

# ADR-014: Keep the period-independence check exact, not approximated

## Context

`tendencyScopeFor` in `packages/self-understanding/src/constructs.ts` decides which historical observation periods count as mutually independent before summing them into `totalSampleCount`. For each period it checks overlap against every earlier kept period by intersecting `sourceEntryIds` (`O(n²·k)` for `n` periods with `k` entries each). This total feeds directly into the `relatively_stable_candidate` scope decision and, more generally, into every sample-count floor in `docs/evidence-thresholds.md`.

This was read and benchmarked, in the algorithmic sense, during general complexity-analysis practice (not as part of the active PCS/MeTheory threshold review). The same total-comparison shape (`O(n²)`-style pairwise checks) also appears in `my-search`'s deduplication and in PCS's applicability-overlap check, so it is a recognizable pattern worth naming once, here, rather than rediscovering per repository. At the current data volume this function is fast; `n` is bounded by how many historical periods exist for one construct/condition/outcome combination, which stays small (tens, not thousands) for a single-user journal.

The concern is not speed. If this check were ever replaced with an approximate similarity method (LSH-style banding, as considered for `my-search`'s deduplication) to handle a larger `n`, the failure mode would be asymmetric: missing a true overlap silently counts two correlated periods as independent, inflating `totalSampleCount` with duplicated evidence. That is the direction that produces false confidence, not the direction that produces a missed insight. It would also conflict with ADR-005 (deterministic evaluation) and ADR-013 (preserve the evaluator, keep results reproducible): an approximate, parameter-tuned overlap check is a form of evaluator change and would need the same versioning and independent-period scrutiny ADR-013 requires, not a silent swap for performance.

## Decision

Keep `tendencyScopeFor`'s overlap/independence check exact. Do not replace it with an approximate or sampled similarity method to gain speed, regardless of future performance work elsewhere in the pipeline. If `n` (periods per construct/condition/outcome combination) ever grows large enough for the exact `O(n²·k)` check to matter in practice, prefer bounding or restructuring the comparison (e.g., capping how many historical periods are considered) over approximating it, and treat any such change as evaluator-affecting under ADR-013.

This ADR does not propose, and is not evaluating, any specific threshold value in `docs/evidence-thresholds.md`. That remains the scope of the separate, ongoing threshold review.

## Consequences

- `totalSampleCount` continues to reflect an exact independent-sample count, not an estimate.
- No performance work is authorized here; none is currently needed at observed data volumes.
- Future contributors (including delegated implementation work) have a documented reason not to "optimize" this function without re-reading this ADR.

## Reversal

Revisit only if profiling on real usage shows this specific function as a measured bottleneck, and only alongside the same versioned, independent-period evaluation ADR-013 requires for any other evaluator change.

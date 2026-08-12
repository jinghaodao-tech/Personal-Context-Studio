# ADR-011: Large-sample significance fallback and candidate audit

## Context
Exact permutation tests grow combinatorially. Returning `null` for large cohorts would discard comparisons merely because more data had been collected. Candidate generation also needs to explain whether a comparison failed a quality gate or statistical significance.

## Decision
Keep exact permutation testing through 200,000 assignments. Above that limit, use a deterministic Monte Carlo permutation test with 10,000 draws and a plus-one p-value estimate, storing the method as `monte_carlo_permutation`. Binary and two-level outcomes use the exact hypergeometric calculation.

Expose a read-only audit containing comparison family size, candidates passing sample/effect/balance/missingness gates, candidates rejected by significance, and accepted candidates before the display limit. The normal candidate API always keeps the significance gate enabled.

Continuous numeric effects use a Cohen's d-style standardized mean difference with pooled standard deviation rather than the declared value range. Cohort boundaries support `range_midpoint`, `observed_median`, and `fixed_threshold`; PCS continuous machine measurements use `observed_median`.

Temporal stability splits the observed candidate period rather than an empty portion of the configured lookback window. The dev-pace audit recorded 55 records and 330 usable machine-measured values; no comparison passed the effect gate, so the result was insufficient evidence rather than a transport failure.

## Alternatives

- Return `null` when exact permutation enumeration becomes too large.
- Relax evidence thresholds until real candidates appear.
- Use a non-deterministic statistical fallback.
- Keep audit data only in logs instead of the analysis result.

These alternatives were rejected because they obscure whether data, quality gates, or significance caused a result and would weaken reproducibility.

## Consequences
Large cohorts remain analyzable with an explicitly labeled conservative fallback. Numeric effects no longer depend on arbitrary administrative ranges. Audits make zero-candidate results diagnosable, but Monte Carlo results remain approximate and real-data conclusions still require review.

## Reversal
Introduce a new versioned evaluator policy with regression fixtures and preserve the existing audit schema. Do not silently change thresholds, p-value methods, or cohort boundaries.

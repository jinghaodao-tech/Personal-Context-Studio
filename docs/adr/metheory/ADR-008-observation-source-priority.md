# ADR-008: Preserve both user and system observations

## Context
MeTheory may receive user-confirmed, deterministic system, and AI-inferred observations for the same field and episode. The raw sources must remain visible, while evaluation needs a deterministic value-selection rule.

## Decision
When multiple observations exist for the same field and episode, the evaluator uses `user_confirmed` first, then `system`, then `ai_inferred`. Ties use the latest observation from that source. Raw provenance remains append-only: a system value is not deleted by a user value, and a user value is not silently replaced by an AI inference.

This priority is scoped to selecting an evaluation value. It does not claim that self-report is objectively more accurate and does not authorize AI to decide facts or evidence strength.

## Alternatives

- A: Keep the current priority, with user-confirmed values selected for subjective constructs.
- B: Prefer deterministic system measurements over self-report.
- C: Never hide either source; retain the disagreement as a separate, reviewable observation.

The current evaluator uses A. C remains the intended direction for a future discrepancy feature now that PCS can provide machine measurements; implementing it requires a separate data model and review flow.

## Consequences

- Evaluation results are reproducible because the priority and tie-break rule are documented.
- Source disagreement remains inspectable in the underlying observations.
- A future discrepancy feature can be added without changing historical raw records.

## Reversal
Adopt a new versioned source-selection policy and migration plan. Do not change historical raw provenance or silently reinterpret completed analysis runs.

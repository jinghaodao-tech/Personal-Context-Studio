# ADR-005: Deterministic evaluation before language generation

## Context
A language model must not decide evidence strength, causality, or a final Self Model update.

## Decision
Compute candidate statistics, data quality, missingness, adherence, and experiment status in TypeScript rules. Local AI may only word an already computed result and must pass DTO validation; fallback wording is deterministic.

## Alternatives
Ask an AI to evaluate raw records; use a cloud model as the default; allow free-form conclusions.

## Consequences
Results are testable and usable offline, with less expressive wording.

## Reversal
Add a new validated explanation provider without changing the evaluator contract.
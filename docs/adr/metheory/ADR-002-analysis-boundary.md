# ADR-002: MeTheory owns analysis, not record authoring

## Context
Personal Context Studio and editors are better at comfortable record creation and human-readable storage.

## Decision
PCS or Markdown remains the record layer. MeTheory owns comparison, evidence, experiments, and user-confirmed Self Model proposals. An Entry is never implicitly converted into experiment data.

## Alternatives
Move all authoring into MeTheory; share one database; automatically extract every note into analysis.

## Consequences
The boundary is easy to explain and supports multiple clients, but integrations must provide a valid snapshot.

## Reversal
Only change this with a replacement source contract and an explicit migration plan.
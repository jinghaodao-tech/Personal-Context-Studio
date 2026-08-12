# ADR-006: Local fixture-first demo

## Context
A portfolio reviewer needs a reproducible flow even when PCS or local AI is unavailable.

## Decision
`npm run demo` starts a local API and Demo Web backed by `fixtures/pcs-analysis-snapshot-v2.json` and `data/demo.sqlite3`. Live PCS is an optional localhost mode.

## Alternatives
Require a running PCS instance; use a cloud demo database; use screenshots only.

## Consequences
The demo is repeatable and privacy-safe. It is not a production deployment or a replacement for integration testing.

## Reversal
Keep the fixture contract and add a documented live setup; do not remove the deterministic path.
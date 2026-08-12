# ADR-009: Remove the obsolete Python runtime

## Context
MeTheory is a single-user local-first TypeScript/Node application. The obsolete Python MVP runtime created a second implementation and allowed schema and behavior drift.

## Decision
Remove the Python MVP runtime, its reference schema, and its Python-only compatibility test from the active repository:

- `backend/core.py`
- `backend/server.py`
- `backend/__init__.py`
- `db/mvp_schema.sql`
- `tools/test_mvp.py`

The TypeScript Node API, `db/ts_mvp_schema.sql`, and the versioned migration runner are the only runtime path.

## Alternatives

- Keep Python as a second supported runtime.
- Keep the Python code as a reference implementation.
- Move the Python code to a separately maintained compatibility repository.

The first two alternatives were rejected because they would make the authoritative schema and lifecycle rules unclear. One-off Python repository tooling remains allowed when documented.

## Consequences

- TypeScript is the sole executable domain implementation.
- Existing SQLite migration and data-preservation tests remain the compatibility safety net.
- The `observations` and `evidence_links` tables remain because current clients and stored data still use them; they are legacy data entities, not a Python runtime.

## Reversal
Introduce a separately versioned runtime and migration plan. Do not restore a second implementation by copying obsolete files into the active path.

# ADR-007: Versioned SQLite migrations

## Context
Startup-time `ALTER TABLE` calls are difficult to audit and can fail half way through a deployment.

## Decision
`apps/api/src/db/migrate.ts` owns ordered, idempotent migration IDs in `schema_migrations`. Structural changes run inside transactions and are safe to repeat.

## Alternatives
Manual SQL commands; one mutable schema file; unversioned `ensureColumn` calls in request startup.

## Consequences
Migration history is inspectable and failures stop startup. Specialized compatibility code still needs gradual cleanup.

## Reversal
Add a forward migration and keep old migration IDs immutable.
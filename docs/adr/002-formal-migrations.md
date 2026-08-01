# ADR-002: Formal Database Migrations

Every SQLite schema change is an ordered, idempotent migration recorded in `schema_migrations`. Migrations run inside `BEGIN IMMEDIATE` transactions and roll back on failure. CI runs `check:migrations` against an in-memory database twice and verifies foreign keys and the latest tables.

PostgreSQL is not required for PCS local-first operation. Any future server database must preserve the same privacy and audit boundaries.

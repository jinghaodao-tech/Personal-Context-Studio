import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyMigrations } from "../apps/api/src/migrations.ts";

test("formal SQLite migrations are idempotent and record every version", () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-migrations-"));
  const database = new DatabaseSync(join(directory, "context.sqlite3"));
  try {
    const schema = readFileSync(resolve(import.meta.dirname, "../db/schema.sql"), "utf8");
    applyMigrations(database, schema);
    applyMigrations(database, schema);
    const versions = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>;
    assert.deepEqual(versions.map((row) => row.version), ["001_core_schema", "002_value_governance", "003_generic_integrations", "004_integration_clients", "005_review_sharing_backup", "006_provenance"]);
    const clients = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_clients'").get();
    const requests = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_template_requests'").get();
    assert.ok(clients);
    assert.ok(requests);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

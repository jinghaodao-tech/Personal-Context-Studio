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
    database.exec("PRAGMA foreign_keys=ON");
    const schema = readFileSync(resolve(import.meta.dirname, "../db/schema.sql"), "utf8");
    applyMigrations(database, schema);
    applyMigrations(database, schema);
    const versions = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>;
    assert.deepEqual(versions.map((row) => row.version), ["001_core_schema", "002_value_governance", "003_generic_integrations", "004_integration_clients", "005_review_sharing_backup", "006_provenance", "007_template_versions_and_export_limits", "008_legacy_column_compatibility", "009_privacy_boundaries_and_template_versions", "010_field_reconfirmation_policy", "011_encrypted_context_values", "012_local_auth_sessions", "013_profile_lifecycle", "014_analysis_choice_semantics","015_context_value_applicability", "016_integration_template_review_states", "017_template_request_provenance_and_timing"]);
    const clients = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_clients'").get();
    const requests = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_template_requests'").get();
    assert.ok(clients);
    assert.ok(requests);
    assert.ok((database.prepare("PRAGMA table_info(context_profiles)").all() as Array<{ name: string }>).some((row) => row.name === "maximum_tokens"));
    assert.ok((database.prepare("PRAGMA table_info(context_profiles)").all() as Array<{ name: string }>).some((row) => row.name === "is_active"));
    assert.ok((database.prepare("PRAGMA table_info(context_exports)").all() as Array<{ name: string }>).some((row) => row.name === "preview_fingerprint"));
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_client_profiles'").get());
    assert.ok((database.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>).some((row) => row.name === "reconfirmation_interval_days"));
    assert.ok((database.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>).some((row) => row.name === "positive_value_keys_json"));
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get());
    assert.ok((database.prepare("PRAGMA table_info(context_backups)").all() as Array<{ name: string }>).some((row) => row.name === "encrypted"));
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='context_value_applicability'").get());
    assert.equal((database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
    assert.throws(() => database.prepare("INSERT INTO context_value_applicability(id,value_id,conflict_id,applicability_condition,created_at) VALUES(?,?,?,?,?)").run("orphan", "missing-value", "missing-conflict", "never", "2026-08-01T00:00:00.000Z"));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    assert.deepEqual(versions.map((row) => row.version), ["001_core_schema", "002_value_governance", "003_generic_integrations", "004_integration_clients", "005_review_sharing_backup", "006_provenance", "007_template_versions_and_export_limits", "008_legacy_column_compatibility", "009_privacy_boundaries_and_template_versions", "010_field_reconfirmation_policy", "011_encrypted_context_values", "012_local_auth_sessions", "013_profile_lifecycle", "014_analysis_choice_semantics","015_context_value_applicability", "016_integration_template_review_states", "017_template_request_provenance_and_timing", "018_template_request_source_provenance", "019_user_experience_state", "020_review_classification_evidence", "021_machine_measured_values", "022_remeasurement_revision_type", "023_opt_in_auto_confirm_elevated_consent", "024_provenance_template_field_subject", "025_concept_registry_and_assertion_kind", "026_provenance_derivation_links", "027_retire_review_classification_reasons"]);
    const clients = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_clients'").get();
    const requests = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_template_requests'").get();
    assert.ok(clients);
    assert.ok(requests);
    assert.ok((database.prepare("PRAGMA table_info(context_profiles)").all() as Array<{ name: string }>).some((row) => row.name === "maximum_tokens"));
    assert.ok((database.prepare("PRAGMA table_info(context_profiles)").all() as Array<{ name: string }>).some((row) => row.name === "is_active"));
    assert.ok((database.prepare("PRAGMA table_info(context_profiles)").all() as Array<{ name: string }>).some((row) => row.name === "include_machine_measured"));
    assert.ok((database.prepare("PRAGMA table_info(context_values)").all() as Array<{ name: string }>).some((row) => row.name === "confirmation_mode"));
    assert.ok((database.prepare("PRAGMA table_info(context_value_revisions)").all() as Array<{ name: string }>).some((row) => row.name === "measurement_json"));
    assert.ok((database.prepare("PRAGMA table_info(context_exports)").all() as Array<{ name: string }>).some((row) => row.name === "preview_fingerprint"));
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_client_profiles'").get());
    assert.ok((database.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>).some((row) => row.name === "reconfirmation_interval_days"));
    assert.ok((database.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>).some((row) => row.name === "positive_value_keys_json"));
    assert.ok((database.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>).some((row) => row.name === "auto_confirm_on_ingestion"));
    assert.doesNotThrow(() => database.prepare("INSERT INTO context_provenance(id,subject_type,subject_id,event_type,actor_type,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)").run("prov_template_field_check", "template_field", "template_x:field_y", "auto_confirm_enabled", "user", "{}", "2026-08-01T00:00:00.000Z"));
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get());
    assert.ok((database.prepare("PRAGMA table_info(context_backups)").all() as Array<{ name: string }>).some((row) => row.name === "encrypted"));
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='context_value_applicability'").get());
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pcs_onboarding_state'").get());
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pcs_review_classifications'").get());
    const reviewColumns = database.prepare("PRAGMA table_info(pcs_review_classifications)").all() as Array<{ name: string }>;
    assert.ok(reviewColumns.some((row) => row.name === "confidence"));
  assert.ok(!reviewColumns.some((row) => row.name === "reason_json"));
    assert.ok((database.prepare("PRAGMA table_info(context_templates)").all() as Array<{ name: string }>).some((row) => row.name === "integration_request_id"));
    assert.equal((database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
    assert.throws(() => database.prepare("INSERT INTO context_value_applicability(id,value_id,conflict_id,applicability_condition,created_at) VALUES(?,?,?,?,?)").run("orphan", "missing-value", "missing-conflict", "never", "2026-08-01T00:00:00.000Z"));
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='context_concepts'").get());
    assert.ok((database.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>).some((row) => row.name === "concept_key"));
    assert.ok((database.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>).some((row) => row.name === "default_kind"));
    assert.ok((database.prepare("PRAGMA table_info(context_values)").all() as Array<{ name: string }>).some((row) => row.name === "kind"));
    assert.ok((database.prepare("PRAGMA table_info(context_value_revisions)").all() as Array<{ name: string }>).some((row) => row.name === "kind"));
    const provenanceColumns = database.prepare("PRAGMA table_info(context_provenance)").all() as Array<{ name: string; dflt_value: string }>;
    const derivedFromColumn = provenanceColumns.find((row) => row.name === "derived_from_ids_json");
    assert.ok(derivedFromColumn, "ADR-020: context_provenance must have derived_from_ids_json");
    assert.equal(derivedFromColumn!.dflt_value, "'[]'");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

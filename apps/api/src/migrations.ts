import type { DatabaseSync } from "node:sqlite";

type Migration = { version: string; apply: () => void };

export function applyMigrations(db: DatabaseSync, schemaSql: string) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
  const migrations: Migration[] = [
    { version: "001_core_schema", apply: () => db.exec(schemaSql) },
    { version: "002_value_governance", apply: () => {
      const columns = db.prepare("PRAGMA table_info(context_values)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "current_revision_id")) db.exec("ALTER TABLE context_values ADD COLUMN current_revision_id TEXT");
      if (!columns.some((column) => column.name === "lifecycle_state")) db.exec("ALTER TABLE context_values ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'");
    } },
    { version: "003_generic_integrations", apply: () => db.exec(`
      CREATE TABLE IF NOT EXISTS integration_template_requests (
        id TEXT PRIMARY KEY, source_system TEXT NOT NULL, source_request_id TEXT NOT NULL,
        source_reference_id TEXT, payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN('pending','template_created','rejected')),
        template_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(source_system,source_request_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS integration_template_requests_status_idx ON integration_template_requests(status,created_at DESC);
      CREATE TABLE IF NOT EXISTS integration_import_records (
        id TEXT PRIMARY KEY, source_system TEXT NOT NULL, source_import_id TEXT NOT NULL,
        source_reference_id TEXT, payload_json TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN('pending','accepted','edited_and_accepted','held','rejected')),
        target_template_id TEXT, target_field_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(source_system,source_import_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS integration_import_records_decision_idx ON integration_import_records(decision,created_at DESC);
    `) },
    { version: "004_integration_clients", apply: () => db.exec(`
      CREATE TABLE IF NOT EXISTS integration_clients (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        permissions_json TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
    `) },
    { version: "005_review_sharing_backup", apply: () => {
      const columns = db.prepare("PRAGMA table_info(context_values)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "reviewed_at")) db.exec("ALTER TABLE context_values ADD COLUMN reviewed_at TEXT");
      if (!columns.some((column) => column.name === "reconfirm_after")) db.exec("ALTER TABLE context_values ADD COLUMN reconfirm_after TEXT");
      if (!columns.some((column) => column.name === "last_reconfirmed_at")) db.exec("ALTER TABLE context_values ADD COLUMN last_reconfirmed_at TEXT");
      const profiles = db.prepare("PRAGMA table_info(context_profiles)").all() as Array<{ name: string }>;
      if (!profiles.some((column) => column.name === "purpose_id")) db.exec("ALTER TABLE context_profiles ADD COLUMN purpose_id TEXT");
      const exports = db.prepare("PRAGMA table_info(context_exports)").all() as Array<{ name: string }>;
      if (!exports.some((column) => column.name === "purpose_id")) db.exec("ALTER TABLE context_exports ADD COLUMN purpose_id TEXT");
      if (!exports.some((column) => column.name === "destination")) db.exec("ALTER TABLE context_exports ADD COLUMN destination TEXT NOT NULL DEFAULT ''");
      if (!exports.some((column) => column.name === "manifest_json")) db.exec("ALTER TABLE context_exports ADD COLUMN manifest_json TEXT NOT NULL DEFAULT '{}'");
      db.exec(`
        CREATE TABLE IF NOT EXISTS context_sharing_purposes (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS context_value_purposes (value_id TEXT NOT NULL REFERENCES context_values(id) ON DELETE CASCADE, purpose_id TEXT NOT NULL REFERENCES context_sharing_purposes(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(value_id,purpose_id)) STRICT;
        CREATE INDEX IF NOT EXISTS context_value_purposes_purpose_idx ON context_value_purposes(purpose_id,value_id);
        CREATE INDEX IF NOT EXISTS context_values_reconfirm_idx ON context_values(reconfirm_after) WHERE user_confirmed=1 AND lifecycle_state='active';
        CREATE TABLE IF NOT EXISTS context_value_reviews (id TEXT PRIMARY KEY, value_id TEXT NOT NULL REFERENCES context_values(id) ON DELETE CASCADE, entry_id TEXT NOT NULL REFERENCES context_entries(id) ON DELETE CASCADE, field_key TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN('accepted','edited_and_accepted','rejected','unknown')), reason TEXT NOT NULL, reviewed_at TEXT NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS context_value_reviews_value_idx ON context_value_reviews(value_id,reviewed_at DESC);
        CREATE TABLE IF NOT EXISTS context_backups (id TEXT PRIMARY KEY, file_name TEXT NOT NULL UNIQUE, file_size INTEGER NOT NULL, file_hash TEXT NOT NULL, created_at TEXT NOT NULL, verified_at TEXT) STRICT;
        CREATE TABLE IF NOT EXISTS context_restore_plans (id TEXT PRIMARY KEY, backup_id TEXT NOT NULL REFERENCES context_backups(id), confirmation_token TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('planned','executed','cancelled')), created_at TEXT NOT NULL, executed_at TEXT) STRICT;
      `);
    } },
    { version: "006_provenance", apply: () => db.exec(`
      CREATE TABLE IF NOT EXISTS context_provenance (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK(subject_type IN('document','entry','value','template','export','integration_import','backup')),
        subject_id TEXT NOT NULL, event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK(actor_type IN('user','local_ai','integration','system')),
        source_ref TEXT, source_content_hash TEXT, provider_id TEXT, model TEXT,
        payload_hash TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS context_provenance_subject_idx ON context_provenance(subject_type,subject_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS context_provenance_source_idx ON context_provenance(source_ref,created_at DESC);
    `) },
  ];
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>).map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.apply();
      db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

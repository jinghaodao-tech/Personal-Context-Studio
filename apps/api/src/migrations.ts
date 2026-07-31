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
    { version: "007_template_versions_and_export_limits", apply: () => {
      const addColumn = (table: string, column: string, definition: string) => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      };
      addColumn("context_templates", "parent_template_id", "TEXT");
      addColumn("context_templates", "immutable", "INTEGER NOT NULL DEFAULT 0");
      addColumn("context_profiles", "maximum_tokens", "INTEGER");
      addColumn("context_exports", "target", "TEXT NOT NULL DEFAULT 'markdown_manual'");
      addColumn("context_exports", "preview_fingerprint", "TEXT");
      addColumn("context_exports", "maximum_tokens", "INTEGER");
      db.exec("CREATE INDEX IF NOT EXISTS context_templates_parent_idx ON context_templates(parent_template_id,version DESC)");
      db.exec("CREATE INDEX IF NOT EXISTS context_exports_fingerprint_idx ON context_exports(preview_fingerprint)");
    } },
    { version: "008_legacy_column_compatibility", apply: () => {
      const addColumn = (table: string, column: string, definition: string) => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      };
      addColumn("context_template_fields", "minimum_value", "REAL");
      addColumn("context_template_fields", "maximum_value", "REAL");
      addColumn("context_template_fields", "unit", "TEXT");
      addColumn("context_template_fields", "analysis_role", "TEXT");
      addColumn("context_template_fields", "analysis_role_confirmed", "INTEGER NOT NULL DEFAULT 0");
      addColumn("context_template_fields", "analysis_usage", "TEXT NOT NULL DEFAULT 'excluded'");
      addColumn("context_template_fields", "analysis_merge_allowed", "INTEGER NOT NULL DEFAULT 0");
      addColumn("context_values", "current_revision_id", "TEXT");
      addColumn("context_values", "lifecycle_state", "TEXT NOT NULL DEFAULT 'active'");
      addColumn("integration_template_requests", "source_request_id", "TEXT NOT NULL DEFAULT ''");
      addColumn("integration_import_records", "source_import_id", "TEXT NOT NULL DEFAULT ''");
    } },
    { version: "009_privacy_boundaries_and_template_versions", apply: () => {
      const addColumn = (table: string, column: string, definition: string) => {
        const columns = db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>;
        if (!columns.some((item) => item.name === column)) db.exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
      };
      addColumn("context_templates", "template_family_id", "TEXT");
      addColumn("context_exports", "renderer_version", "TEXT NOT NULL DEFAULT 'pcs-renderer-v2'");
      addColumn("context_exports", "detail_level", "TEXT NOT NULL DEFAULT 'standard'");
      addColumn("context_conflicts", "resolution_json", "TEXT NOT NULL DEFAULT '{}'");
      db.exec("CREATE TABLE IF NOT EXISTS integration_client_profiles (client_id TEXT NOT NULL REFERENCES integration_clients(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES context_profiles(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(client_id,profile_id)) STRICT; CREATE INDEX IF NOT EXISTS integration_client_profiles_profile_idx ON integration_client_profiles(profile_id,client_id); CREATE INDEX IF NOT EXISTS context_templates_family_version_idx ON context_templates(template_family_id,version); CREATE UNIQUE INDEX IF NOT EXISTS context_templates_active_family_idx ON context_templates(template_family_id) WHERE status='active' AND template_family_id IS NOT NULL; CREATE INDEX IF NOT EXISTS context_conflicts_status_idx ON context_conflicts(status,created_at DESC);");
    } },
    { version: "010_field_reconfirmation_policy", apply: () => {
      const columns = db.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "reconfirmation_mode")) db.exec("ALTER TABLE context_template_fields ADD COLUMN reconfirmation_mode TEXT NOT NULL DEFAULT 'none'");
      if (!columns.some((column) => column.name === "reconfirmation_interval_days")) db.exec("ALTER TABLE context_template_fields ADD COLUMN reconfirmation_interval_days INTEGER");
    } },
    { version: "011_encrypted_context_values", apply: () => {
      const values = db.prepare("PRAGMA table_info(context_values)").all() as Array<{ name: string }>;
      const revisions = db.prepare("PRAGMA table_info(context_value_revisions)").all() as Array<{ name: string }>;
      if (!values.some((column) => column.name === "encrypted")) db.exec("ALTER TABLE context_values ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0");
      if (!revisions.some((column) => column.name === "encrypted")) db.exec("ALTER TABLE context_value_revisions ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0");
      db.exec("CREATE INDEX IF NOT EXISTS context_values_encrypted_idx ON context_values(encrypted,sensitivity)");
      const backups = db.prepare("PRAGMA table_info(context_backups)").all() as Array<{ name: string }>;
      if (!backups.some((column) => column.name === "encrypted")) db.exec("ALTER TABLE context_backups ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0");
    } },
    { version: "012_local_auth_sessions", apply: () => {
      db.exec("CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT) STRICT; CREATE INDEX IF NOT EXISTS auth_sessions_active_idx ON auth_sessions(token_hash,expires_at) WHERE revoked_at IS NULL");
    } },
    { version: "013_profile_lifecycle", apply: () => {
      const columns = db.prepare("PRAGMA table_info(context_profiles)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "is_active")) db.exec("ALTER TABLE context_profiles ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1))");
      db.exec("CREATE INDEX IF NOT EXISTS context_profiles_active_idx ON context_profiles(is_active,updated_at DESC)");
    } },
    { version: "014_analysis_choice_semantics", apply: () => {
      const addColumn = (column: string, definition: string) => { const columns = db.prepare("PRAGMA table_info(context_template_fields)").all() as Array<{ name: string }>; if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE context_template_fields ADD COLUMN ${column} ${definition}`); };
      addColumn("positive_value_keys_json", "TEXT NOT NULL DEFAULT '[]'");
      addColumn("ordered_value_keys_json", "TEXT NOT NULL DEFAULT '[]'");
      addColumn("numeric_mapping_json", "TEXT NOT NULL DEFAULT '{}'");
    } },
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

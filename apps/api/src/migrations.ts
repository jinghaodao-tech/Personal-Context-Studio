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

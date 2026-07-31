import type { DatabaseSync } from "node:sqlite";

export function listMigrations(db: DatabaseSync) {
  return db.prepare("SELECT version,applied_at FROM schema_migrations ORDER BY applied_at DESC").all();
}

export function listBackups(db: DatabaseSync) {
  return db.prepare("SELECT * FROM context_backups ORDER BY created_at DESC").all() as any[];
}

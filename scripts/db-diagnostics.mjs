import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(process.env.PCS_DB ?? "data/personal-context-studio.sqlite3");
const result = { ok: true, databasePath, integrity: null, foreignKeyErrors: 0, migrationCount: 0, backups: { registered: 0, available: 0, invalid: 0 }, errors: [] };
if (!existsSync(databasePath)) {
  result.ok = false;
  result.errors.push("database_not_found");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
const db = new DatabaseSync(databasePath);
try {
  result.integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (result.integrity !== "ok") { result.ok = false; result.errors.push("integrity_check_failed"); }
  result.foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all().length;
  if (result.foreignKeyErrors) { result.ok = false; result.errors.push("foreign_key_check_failed"); }
  result.migrationCount = Number(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count);
  const backupDirectory = resolve(process.env.PCS_BACKUP_DIR ?? resolve(databasePath, "..", "backups"));
  const backups = db.prepare("SELECT file_name,file_hash FROM context_backups ORDER BY created_at DESC").all();
  result.backups.registered = backups.length;
  for (const backup of backups) {
    const path = resolve(backupDirectory, backup.file_name);
    if (!existsSync(path)) { result.backups.invalid += 1; continue; }
    result.backups.available += 1;
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actual !== backup.file_hash) result.backups.invalid += 1;
  }
  if (result.backups.invalid) { result.ok = false; result.errors.push("backup_integrity_failed"); }
  console.log(JSON.stringify(result, null, 2));
} finally { db.close(); }
if (!result.ok) process.exitCode = 1;

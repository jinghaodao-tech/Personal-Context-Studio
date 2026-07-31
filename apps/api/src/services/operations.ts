import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { listBackups, listMigrations } from "../repositories/operations.ts";

export function readOperationsStatus(input: { db: DatabaseSync; watcherStatePath: string; databasePath: string; encryptionConfigured: boolean }) {
  const migrations = listMigrations(input.db);
  let watcher: unknown = null;
  try { watcher = JSON.parse(readFileSync(input.watcherStatePath, "utf8")); } catch { /* unavailable is a valid stopped state */ }
  return { service: "personal-context-studio", databasePath: input.databasePath, encryptionConfigured: input.encryptionConfigured, migrationCount: migrations.length, latestMigration: migrations[0] ?? null, watcher };
}

export function inspectBackups(rows: any[], backupDirectory: string, hashFile: (path: string) => string) {
  return rows.map((item) => {
    const path = resolve(backupDirectory, item.file_name);
    const available = existsSync(path);
    let integrityValid = false;
    try { integrityValid = available && hashFile(path) === item.file_hash; } catch { /* report invalid instead of failing the list */ }
    return { ...item, available, integrityValid };
  });
}

export function readBackupRecords(db: DatabaseSync, backupDirectory: string, hashFile: (path: string) => string) {
  return inspectBackups(listBackups(db), backupDirectory, hashFile);
}

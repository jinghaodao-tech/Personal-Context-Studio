import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decryptFileBytes, encryptionKey } from "../packages/crypto/src/index.ts";

const backupId = process.argv[2];
if (!backupId) throw new Error("backup_id_required");
const databasePath = resolve(process.env.PCS_DB ?? "data/personal-context-studio.sqlite3");
const backupDirectory = resolve(process.env.PCS_BACKUP_DIR ?? resolve(databasePath, "..", "backups"));
const sourceDb = new DatabaseSync(databasePath, { readOnly: true });
let temporaryPath;
try {
  const backup = sourceDb.prepare("SELECT id,file_name,file_hash,encrypted FROM context_backups WHERE id=?").get(backupId);
  if (!backup) throw new Error("backup_not_found");
  const sourcePath = resolve(backupDirectory, backup.file_name);
  if (!existsSync(sourcePath)) throw new Error("backup_file_not_found");
  const actualHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  if (actualHash !== backup.file_hash) throw new Error("backup_integrity_failed");
  temporaryPath = resolve(backupDirectory, `.verify-${randomUUID()}.sqlite3`);
  if (backup.encrypted) writeFileSync(temporaryPath, decryptFileBytes(readFileSync(sourcePath), encryptionKey(process.env.PCS_ENCRYPTION_KEY)));
  else copyFileSync(sourcePath, temporaryPath);
  const restored = new DatabaseSync(temporaryPath, { readOnly: true });
  try {
    const integrity = restored.prepare("PRAGMA integrity_check").get().integrity_check;
    const foreignKeyErrors = restored.prepare("PRAGMA foreign_key_check").all().length;
    const migrationCount = Number(restored.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count);
    const result = { ok: integrity === "ok" && foreignKeyErrors === 0, backupId, integrity, foreignKeyErrors, migrationCount };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally { restored.close(); }
} finally {
  sourceDb.close();
  if (temporaryPath && existsSync(temporaryPath)) unlinkSync(temporaryPath);
}

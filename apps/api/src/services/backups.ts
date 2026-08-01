import { copyFileSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { decryptFileBytes, encryptFileBytes, encryptionFingerprint } from "../../../../packages/crypto/src/index.ts";

export type BackupStoreContext = {
  db: DatabaseSync;
  backupDirectory: string;
  encryptionKey?: Buffer;
  now: () => string;
  newId: (prefix: string) => string;
  fileHash: (path: string) => string;
  audit: (action: string, summary: unknown) => void;
  provenance: (input: any) => void;
};

export function createBackup(context: BackupStoreContext) {
  mkdirSync(context.backupDirectory, { recursive: true });
  const id = context.newId("backup");
  const encrypted = Boolean(context.encryptionKey);
  const fileName = `${id}.${encrypted ? "sqlite3.enc" : "sqlite3"}`;
  const plainPath = resolve(context.backupDirectory, `${id}.sqlite3`);
  const filePath = resolve(context.backupDirectory, fileName);
  context.db.exec(`VACUUM INTO '${plainPath.replaceAll("'", "''")}'`);
  if (encrypted) {
    writeFileSync(filePath, encryptFileBytes(readFileSync(plainPath), context.encryptionKey));
    unlinkSync(plainPath);
  } else if (filePath !== plainPath) copyFileSync(plainPath, filePath);
  const timestamp = context.now();
  const size = statSync(filePath).size;
  const hash = context.fileHash(filePath);
  context.db.prepare("INSERT INTO context_backups(id,file_name,file_size,file_hash,encrypted,created_at,verified_at) VALUES(?,?,?,?,?,?,?)").run(id, fileName, size, hash, encrypted ? 1 : 0, timestamp, timestamp);
  context.audit("create_backup", { backupId: id, fileSize: size, encrypted });
  context.provenance({ subjectType: "backup", subjectId: id, eventType: "created", actorType: "system", sourceRef: fileName, sourceContentHash: hash, metadata: { fileSize: size, encrypted } });
  return { id, fileName, fileSize: size, fileHash: hash, encrypted, encryptionKeyFingerprint: encryptionFingerprint(context.encryptionKey), createdAt: timestamp };
}

export function createRestorePlan(context: Pick<BackupStoreContext, "db" | "backupDirectory" | "fileHash" | "newId" | "now">, backupId: string) {
  const backup = context.db.prepare("SELECT * FROM context_backups WHERE id=?").get(backupId) as { file_name: string; file_hash: string } | undefined;
  if (!backup) return { error: "backup_not_found" as const };
  const filePath = resolve(context.backupDirectory, backup.file_name);
  if (context.fileHash(filePath) !== backup.file_hash) return { error: "backup_integrity_failed" as const };
  const id = context.newId("restore_plan");
  const confirmation = `RESTORE ${backupId}`;
  context.db.prepare("INSERT INTO context_restore_plans(id,backup_id,confirmation_token,status,created_at) VALUES(?,?,?,?,?)").run(id, backupId, confirmation, "planned", context.now());
  return { planId: id, backupId, confirmation, restartRequired: true };
}

export function stageRestore(context: Pick<BackupStoreContext, "db" | "backupDirectory" | "fileHash"> & { databasePath: string; encryptionKey?: Buffer }, input: { planId: string; backupId: string; confirmation: string }) {
  const plan = context.db.prepare("SELECT p.*,b.file_name,b.file_hash,b.encrypted FROM context_restore_plans p JOIN context_backups b ON b.id=p.backup_id WHERE p.id=? AND p.backup_id=? AND p.status='planned'").get(input.planId, input.backupId) as { id: string; file_name: string; file_hash: string; encrypted: number; confirmation_token: string } | undefined;
  if (!plan || input.confirmation !== plan.confirmation_token) return { error: "restore_confirmation_required" as const };
  const filePath = resolve(context.backupDirectory, plan.file_name);
  if (context.fileHash(filePath) !== plan.file_hash) return { error: "backup_integrity_failed" as const };
  const stagingPath = `${context.databasePath}.restore`;
  if (plan.encrypted) writeFileSync(stagingPath, decryptFileBytes(readFileSync(filePath), context.encryptionKey));
  else copyFileSync(filePath, stagingPath);
  return { plan, stagingPath };
}

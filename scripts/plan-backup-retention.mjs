import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const apply = process.argv.includes("--apply");
const keep = Math.max(1, Number(process.env.PCS_BACKUP_KEEP ?? 5));
const databasePath = resolve(process.env.PCS_DB ?? "data/personal-context-studio.sqlite3");
const backupDirectory = resolve(process.env.PCS_BACKUP_DIR ?? resolve(databasePath, "..", "backups"));
const db = new DatabaseSync(databasePath);
try {
  const rows = db.prepare("SELECT id,file_name,created_at FROM context_backups ORDER BY created_at DESC").all();
  const candidates = rows.slice(keep).filter((row) => existsSync(resolve(backupDirectory, row.file_name)));
  if (apply) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of candidates) { unlinkSync(resolve(backupDirectory, row.file_name)); db.prepare("DELETE FROM context_backups WHERE id=?").run(row.id); }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  console.log(JSON.stringify({ ok: true, applied: apply, keep, candidates: candidates.map((row) => ({ id: row.id, fileName: row.file_name, createdAt: row.created_at })), removed: apply ? candidates.length : 0 }, null, 2));
} finally { db.close(); }

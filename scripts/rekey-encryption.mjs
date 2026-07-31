import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decryptFileBytes, decryptText, encryptFileBytes, encryptText, encryptionKey } from "../packages/crypto/src/index.ts";

const databasePath = resolve(process.env.PCS_DB ?? "data/personal-context-studio.sqlite3");
const backupDirectory = resolve(process.env.PCS_BACKUP_DIR ?? resolve(databasePath, "..", "backups"));
const oldKey = encryptionKey(process.env.PCS_OLD_ENCRYPTION_KEY);
const newKey = encryptionKey(process.env.PCS_ENCRYPTION_KEY);
if (!newKey) throw new Error("PCS_ENCRYPTION_KEY is required for rekeying");
const db = new DatabaseSync(databasePath);
let valueCount = 0;
try {
  db.exec("BEGIN IMMEDIATE");
  const migrate = db.prepare("SELECT id,value_json,encrypted,sensitivity FROM context_values");
  const update = db.prepare("UPDATE context_values SET value_json=?,encrypted=? WHERE id=?");
  for (const row of migrate.all()) {
    const source = row.encrypted ? decryptText(row.value_json, oldKey) : row.value_json;
    if (row.sensitivity === "normal") continue;
    update.run(encryptText(source, newKey), 1, row.id); valueCount += 1;
  }
  const revisions = db.prepare("SELECT id,value_json,encrypted,sensitivity FROM context_value_revisions");
  const updateRevision = db.prepare("UPDATE context_value_revisions SET value_json=?,encrypted=? WHERE id=?");
  for (const row of revisions.all()) {
    const source = row.encrypted ? decryptText(row.value_json, oldKey) : row.value_json;
    if (row.sensitivity === "normal") continue;
    updateRevision.run(encryptText(source, newKey), 1, row.id); valueCount += 1;
  }
  db.exec("COMMIT");
} catch (error) { db.exec("ROLLBACK"); db.close(); throw error; }

let backupCount = 0;
for (const name of existsSync(backupDirectory) ? readdirSync(backupDirectory, { withFileTypes: true }) : []) {
  if (!name.isFile() || !name.name.endsWith(".sqlite3.enc")) continue;
  const filePath = resolve(backupDirectory, name.name);
  const plain = decryptFileBytes(readFileSync(filePath), oldKey);
  writeFileSync(filePath, encryptFileBytes(plain, newKey));
  const hash = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  db.prepare("UPDATE context_backups SET file_hash=?,file_size=?,encrypted=1 WHERE file_name=?").run(hash, statSync(filePath).size, name.name);
  backupCount += 1;
}
db.close();
console.log(JSON.stringify({ reencryptedValues: valueCount, reencryptedBackups: backupCount }));

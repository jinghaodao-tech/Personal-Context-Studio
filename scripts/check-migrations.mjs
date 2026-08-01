import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyMigrations } from "../apps/api/src/migrations.ts";

const database = new DatabaseSync(":memory:");
try {
  database.exec("PRAGMA foreign_keys=ON");
  applyMigrations(database, readFileSync(resolve(import.meta.dirname, "../db/schema.sql"), "utf8"));
  applyMigrations(database, readFileSync(resolve(import.meta.dirname, "../db/schema.sql"), "utf8"));
  const versions = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.ok(versions.length >= 15);
  assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_value_applicability'").get());
  console.log(`migration check passed: ${versions.length} versions`);
} finally { database.close(); }

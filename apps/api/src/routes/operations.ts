import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, renameSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { readBackupRecords, readOperationsStatus } from "../services/operations.ts";
import { createBackup, createRestorePlan, stageRestore } from "../services/backups.ts";

type OperationsContext = { db: DatabaseSync; databasePath: string; backupDirectory: string; watcherStatePath: string; encryptionKey?: Buffer; send: (response: ServerResponse, status: number, value: unknown) => unknown; now: () => string; newId: (prefix: string) => string; fileHash: (path: string) => string; audit: (action: string, summary: unknown) => void; provenance: (input: any) => void };

export async function handleOperationsRoute(request: IncomingMessage, response: ServerResponse, url: URL, parts: string[], context: OperationsContext): Promise<boolean> {
  const { db, send } = context;
  if (request.method === "GET" && url.pathname === "/v1/ops/status") { send(response, 200, readOperationsStatus({ db, watcherStatePath: context.watcherStatePath, databasePath: context.databasePath, encryptionConfigured: Boolean(context.encryptionKey) })); return true; }
  if (request.method === "GET" && url.pathname === "/v1/dashboard/audit") { const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 100); const action = text(url.searchParams.get("action")); const cursorParts = text(url.searchParams.get("before")).split("|"); const beforeAt = cursorParts.length > 1 ? cursorParts[0] : ""; const beforeId = cursorParts.length > 1 ? cursorParts.slice(1).join("|") : ""; const predicate = beforeAt && beforeId ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""; const params = predicate ? [beforeAt, beforeAt, beforeId] : []; const query = (base: string) => action ? db.prepare(`${base} AND action=?${predicate} ORDER BY created_at DESC, id DESC LIMIT ?`).all(action, ...params, limit) : db.prepare(`${base}${predicate} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params, limit); const items = query("SELECT id,action,summary_json,created_at FROM privacy_audit_logs WHERE 1=1"); const last = items.at(-1) as { id?: string; created_at?: string } | undefined; send(response, 200, { items, nextCursor: items.length === limit && last?.id && last.created_at ? `${last.created_at}|${last.id}` : null }); return true; }
  if (request.method === "GET" && url.pathname === "/v1/backups") { send(response, 200, { items: readBackupRecords(db, context.backupDirectory, context.fileHash) }); return true; }
  if (request.method === "POST" && url.pathname === "/v1/backups") { send(response, 201, createBackup(context)); return true; }
  if (request.method === "POST" && parts[0] === "v1" && parts[1] === "backups" && parts[2] && parts[3] === "restore-plan") { const result = createRestorePlan(context, parts[2]); if ("error" in result) { send(response, result.error === "backup_not_found" ? 404 : 409, { error: result.error }); return true; } send(response, 200, result); return true; }
  if (request.method === "POST" && parts[0] === "v1" && parts[1] === "backups" && parts[2] && parts[3] === "restore") { const input = await readBody(request); const result = stageRestore({ ...context, databasePath: context.databasePath }, { planId: text(input.planId), backupId: parts[2], confirmation: text(input.confirmation) }); if ("error" in result) { send(response, result.error === "backup_integrity_failed" ? 409 : 400, { error: result.error }); return true; } const { plan, stagingPath } = result; db.prepare("UPDATE context_restore_plans SET status='executed',executed_at=? WHERE id=?").run(context.now(), plan.id); context.audit("restore_backup_scheduled", { backupId: parts[2], planId: plan.id, encrypted: Boolean(plan.encrypted) }); send(response, 202, { restoring: true, restartRequired: true }); setTimeout(() => { try { db.close(); renameSync(context.databasePath, `${context.databasePath}.before-restore`); renameSync(stagingPath, context.databasePath); process.exit(0); } catch (error) { console.error(`Restore failed: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); } }, 100); return true; }
  return false;
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    throw new Error("invalid_json");
  }
}

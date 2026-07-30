import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { eligibleForExport, isSecretLike, newId, validateField, type ContextTemplateField, type Sharing, type Sensitivity } from "../../../packages/domain/src/index.ts";
import { CONTEXT_ANALYSIS_SNAPSHOT_VERSION, validateIntegrationImport, validateIntegrationTemplateRequest, type IntegrationTemplateRequestV1 } from "../../../packages/integration-contracts/src/index.ts";
import { excerpt, readMarkdownSnapshot } from "../../../packages/documents/src/index.ts";
import { createLocalAiProvider, validateTemplateDraft } from "../../../packages/ai-core/src/index.ts";
import { estimateTokens, normalizeExportTarget, storedFormat, truncateRenderedTarget } from "../../../packages/export-renderers/src/index.ts";
import { RuntimeManager, detectOllama, detectOpenAiCompatible } from "../../../packages/local-ai-runtime/src/index.ts";
import { dashboardHtml } from "./dashboardHtml.ts";
import { hashIntegrationToken, integrationAuthorized, integrationPermissions, isIntegrationRequest, managementAuthorized, type IntegrationPermission } from "./integrationAccess.ts";
import { applyMigrations } from "./migrations.ts";

const root = resolve(import.meta.dirname, "../../..");
const databasePath = process.env.PCS_DB ?? resolve(root, "data", "personal-context-studio.sqlite3");
const backupDirectory = resolve(process.env.PCS_BACKUP_DIR ?? resolve(dirname(databasePath), "backups"));
const watcherStatePath = resolve(process.env.PCS_WATCH_STATE ?? resolve(root, "data", "watcher-state.json"));
const adminToken = process.env.PCS_ADMIN_TOKEN;
const notesRoot = resolve(process.env.PCS_NOTES_DIR ?? resolve(root, "notes"));
mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(notesRoot, { recursive: true });
const db = new DatabaseSync(databasePath);
applyMigrations(db, readFileSync(resolve(root, "db", "schema.sql"), "utf8"));
const now = () => new Date().toISOString();
const localAiProvider = createLocalAiProvider({ provider: process.env.PCS_AI_PROVIDER, model: process.env.PCS_AI_MODEL, baseUrl: process.env.PCS_AI_BASE_URL });
function runtimeArguments() {
  try {
    const value = process.env.PCS_AI_ARGUMENTS;
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch { return []; }
}
const localAiRuntime = new RuntimeManager({ executablePath: process.env.PCS_AI_EXECUTABLE, arguments: runtimeArguments(), idleTimeoutMinutes: Number(process.env.PCS_AI_IDLE_MINUTES ?? 15) });
const allowedSharing = new Set<Sharing>(["always", "purpose_only", "private", "never"]);
const allowedSensitivity = new Set<Sensitivity>(["normal", "sensitive", "highly_sensitive"]);

function send(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { throw new Error("invalid_json"); } }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }function clientErrorStatus(message: string): number | undefined {
  const prefixes = ["invalid_json", "document_", "search_", "template_", "context_", "profile_", "review_", "reconfirm_", "conflict_", "sharing_", "export_", "external_", "integration_", "safe_", "restore_", "secret_", "required_", "revision_", "extraction_", "runtime_", "manual_", "disabled", "remote_"];
  if (!prefixes.some((prefix) => message.startsWith(prefix))) return undefined;
  return message.includes("stale") || message.includes("conflict") ? 409 : 400;
}
function fields(templateId: string) { return db.prepare("SELECT * FROM context_template_fields WHERE template_id=? ORDER BY display_order").all(templateId).map((field: any) => ({ ...field, required: Boolean(field.required), options: JSON.parse(field.options_json) })); }
function templateDetail(id: string) { const template = db.prepare("SELECT * FROM context_templates WHERE id=?").get(id) as any; return template ? { ...template, fields: fields(id) } : undefined; }
function audit(action: string, summary: unknown) { db.prepare("INSERT INTO privacy_audit_logs(id,action,summary_json,created_at) VALUES(?,?,?,?)").run(newId("audit"), action, JSON.stringify(summary), now()); }
function fileHash(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function validPurpose(id: string) { return Boolean(db.prepare("SELECT 1 FROM context_sharing_purposes WHERE id=? AND is_active=1").get(id)); }
function provenance(input: { subjectType: "document" | "entry" | "value" | "template" | "export" | "integration_import" | "backup"; subjectId: string; eventType: string; actorType: "user" | "local_ai" | "integration" | "system"; sourceRef?: string | null; sourceContentHash?: string | null; providerId?: string | null; model?: string | null; payload?: unknown; metadata?: Record<string, unknown> }) {
  const payload = input.payload === undefined ? null : createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  db.prepare("INSERT INTO context_provenance(id,subject_type,subject_id,event_type,actor_type,source_ref,source_content_hash,provider_id,model,payload_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(newId("provenance"), input.subjectType, input.subjectId, input.eventType, input.actorType, input.sourceRef ?? null, input.sourceContentHash ?? null, input.providerId ?? null, input.model ?? null, payload, JSON.stringify(input.metadata ?? {}), now());
}

type RevisionChangeType = "initial" | "correction" | "state_change" | "exception" | "reaffirmation" | "retraction";
const revisionChangeTypes = new Set<RevisionChangeType>(["initial", "correction", "state_change", "exception", "reaffirmation", "retraction"]);

function revisionSourceHash(entryId: string) {
  return (db.prepare("SELECT source_content_hash FROM context_entry_candidates WHERE entry_id=?").get(entryId) as { source_content_hash?: string } | undefined)?.source_content_hash ?? null;
}

function valueRow(entryId: string, fieldKey: string) {
  return db.prepare("SELECT v.*,e.template_id FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE v.entry_id=? AND v.field_key=? AND e.status!='archived'").get(entryId, fieldKey) as any;
}

function addRevision(input: { entryId: string; fieldKey: string; value?: unknown; changeType?: string; reason?: string; validFrom?: unknown; validTo?: unknown; sharing?: unknown; sensitivity?: unknown; reconfirmAfter?: unknown }) {
  const current = valueRow(input.entryId, input.fieldKey);
  if (!current) throw new Error("context_value_not_found");
  const previousValue = JSON.parse(current.value_json);
  const value = input.value === undefined ? previousValue : input.value;
  if (isSecretLike(typeof value === "string" ? value : JSON.stringify(value))) throw new Error("secret_value_prohibited");
  const changeType = (input.changeType || (current.user_confirmed ? "correction" : "initial")) as RevisionChangeType;
  if (!revisionChangeTypes.has(changeType)) throw new Error("revision_change_type_invalid");
  const reason = text(input.reason) || (changeType === "initial" ? "Initial confirmed value" : "");
  if (!reason || reason.length > 1000) throw new Error("revision_reason_required");
  const validFrom = input.validFrom === undefined || input.validFrom === null || input.validFrom === "" ? null : validTimestamp(input.validFrom) ? input.validFrom : (() => { throw new Error("revision_valid_from_invalid"); })();
  const validTo = input.validTo === undefined || input.validTo === null || input.validTo === "" ? null : validTimestamp(input.validTo) ? input.validTo : (() => { throw new Error("revision_valid_to_invalid"); })();
  if (validFrom && validTo && Date.parse(validFrom) >= Date.parse(validTo)) throw new Error("revision_valid_period_invalid");
  const sharing = allowedSharing.has(text(input.sharing) as Sharing) ? text(input.sharing) : current.sharing;
  const sensitivity = allowedSensitivity.has(text(input.sensitivity) as Sensitivity) ? text(input.sensitivity) : current.sensitivity;
  const reconfirmAfter = input.reconfirmAfter === undefined ? current.reconfirm_after : input.reconfirmAfter === null || input.reconfirmAfter === "" ? null : validTimestamp(input.reconfirmAfter) ? input.reconfirmAfter : (() => { throw new Error("reconfirm_after_invalid"); })();
  const timestamp = now();
  const revisionId = newId("revision");
  if (changeType === "state_change" && validFrom && current.current_revision_id) db.prepare("UPDATE context_value_revisions SET valid_to=? WHERE id=? AND valid_to IS NULL").run(validFrom, current.current_revision_id);
  db.prepare("INSERT INTO context_value_revisions(id,value_id,entry_id,field_key,value_json,change_type,reason,valid_from,valid_to,sharing,sensitivity,supersedes_revision_id,source_id,source_content_hash,user_confirmed,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(revisionId, current.id, input.entryId, input.fieldKey, JSON.stringify(value), changeType, reason, validFrom, validTo, sharing, sensitivity, current.current_revision_id ?? null, current.source_id ?? null, revisionSourceHash(input.entryId), 1, timestamp, timestamp);
  db.prepare("UPDATE context_values SET value_json=?,user_confirmed=1,reviewed_at=CASE WHEN user_confirmed=0 THEN ? ELSE reviewed_at END,last_reconfirmed_at=CASE WHEN user_confirmed=0 THEN ? ELSE last_reconfirmed_at END,reconfirm_after=?,sharing=?,sensitivity=?,current_revision_id=?,lifecycle_state=?,updated_at=? WHERE id=?").run(JSON.stringify(value), timestamp, timestamp, reconfirmAfter, sharing, sensitivity, revisionId, changeType === "retraction" ? "retracted" : "active", timestamp, current.id);
  audit("revise_context_value", { entryId: input.entryId, fieldKey: input.fieldKey, revisionId, changeType, lifecycleState: changeType === "retraction" ? "retracted" : "active" });
  provenance({ subjectType: "value", subjectId: current.id, eventType: changeType === "initial" ? "confirmed" : "revised", actorType: "user", sourceRef: current.source_id, sourceContentHash: revisionSourceHash(input.entryId), metadata: { entryId: input.entryId, fieldKey: input.fieldKey, changeType } });
  return { revisionId, changeType, lifecycleState: changeType === "retraction" ? "retracted" : "active" };
}

function createInitialRevision(valueId: string, reason = "Initial confirmed value") {
  const row = db.prepare("SELECT v.*,e.status FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE v.id=?").get(valueId) as any;
  if (!row || !row.user_confirmed || row.current_revision_id || row.status === "archived") return;
  const revisionId = newId("revision"); const timestamp = now();
  db.prepare("INSERT INTO context_value_revisions(id,value_id,entry_id,field_key,value_json,change_type,reason,valid_from,valid_to,sharing,sensitivity,supersedes_revision_id,source_id,source_content_hash,user_confirmed,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(revisionId, row.id, row.entry_id, row.field_key, row.value_json, "initial", reason, row.recorded_at, null, row.sharing, row.sensitivity, null, row.source_id ?? null, revisionSourceHash(row.entry_id), 1, timestamp, timestamp);
  db.prepare("UPDATE context_values SET current_revision_id=?,lifecycle_state=COALESCE(lifecycle_state,'active') WHERE id=?").run(revisionId, row.id);
}

for (const row of db.prepare("SELECT id FROM context_values WHERE user_confirmed=1 AND current_revision_id IS NULL").all() as Array<{ id: string }>) createInitialRevision(row.id, "Initial value migrated into revision history");
function exportPreview(profileId: string, format: string, destination = "", options: { target?: unknown; maximumCharacters?: unknown; maximumTokens?: unknown } = {}) {
  const profile = db.prepare("SELECT * FROM context_profiles WHERE id=?").get(profileId) as any;
  if (!profile) throw new Error("profile_not_found");
  const selected = db.prepare("SELECT template_id,field_key FROM context_profile_fields WHERE profile_id=?").all(profileId) as Array<{ template_id: string; field_key: string }>;
  const placeholders = selected.length ? selected.map(() => "?").join(",") : "''";
  const rows = db.prepare(`SELECT v.*,f.label,e.template_id FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' AND v.lifecycle_state='active' AND (e.template_id || ':' || v.field_key) IN (${placeholders}) ORDER BY v.updated_at DESC`).all(...selected.map((item) => `${item.template_id}:${item.field_key}`)) as any[];
  const latest = new Map<string, any>(); for (const row of rows) if (!latest.has(`${row.template_id}:${row.field_key}`)) latest.set(`${row.template_id}:${row.field_key}`, row);
  const selectedValueIds = new Set([...latest.values()].map((row) => row.id));
  const unresolved = db.prepare("SELECT id,value_ids_json FROM context_conflicts WHERE status='unresolved'").all() as Array<{ id: string; value_ids_json: string }>;
  if (unresolved.some((conflict) => { try { return (JSON.parse(conflict.value_ids_json) as unknown[]).some((id) => selectedValueIds.has(String(id))); } catch { return false; } })) throw new Error("unresolved_context_conflict");
  const purposeIds = new Set((db.prepare("SELECT value_id FROM context_value_purposes WHERE purpose_id=?").all(profile.purpose_id ?? "") as Array<{ value_id: string }>).map((row) => row.value_id));
  const omitted = { unconfirmed: 0, privateOrNever: 0, highlySensitive: 0, purposeNotAllowed: 0, invalid: 0, truncated: 0 };
  const safe = [...latest.values()].filter((row) => {
    try { JSON.parse(row.value_json); } catch { omitted.invalid += 1; return false; }
    if (!row.user_confirmed) { omitted.unconfirmed += 1; return false; }
    if (row.sensitivity === "highly_sensitive") { omitted.highlySensitive += 1; return false; }
    if (row.sharing === "private" || row.sharing === "never") { omitted.privateOrNever += 1; return false; }
    if (row.sharing === "purpose_only" && (!profile.purpose_id || !purposeIds.has(row.id))) { omitted.purposeNotAllowed += 1; return false; }
    return eligibleForExport({ sharing: row.sharing, sensitivity: row.sensitivity, userConfirmed: true });
  });
  const target = normalizeExportTarget(options.target ?? profile.target, format);
  const maximumCharacters = Number.isInteger(options.maximumCharacters) && Number(options.maximumCharacters) > 0 ? Number(options.maximumCharacters) : Number.isInteger(profile.maximum_characters) && profile.maximum_characters > 0 ? profile.maximum_characters : undefined;
  const maximumTokens = Number.isInteger(options.maximumTokens) && Number(options.maximumTokens) > 0 ? Number(options.maximumTokens) : Number.isInteger(profile.maximum_tokens) && profile.maximum_tokens > 0 ? profile.maximum_tokens : undefined;
  const rendered = truncateRenderedTarget(safe.map((row) => ({ label: row.label, fieldKey: row.field_key, value: JSON.parse(row.value_json) })), target, maximumCharacters, maximumTokens);
  if (rendered.truncated) omitted.truncated = 1;
  const omittedCount = Object.values(omitted).reduce((total, count) => total + count, 0);
  const previewFingerprint = createHash("sha256").update(JSON.stringify({ profileId, target, format: storedFormat(target), content: rendered.content, omitted, maximumCharacters, maximumTokens })).digest("hex");
  return { schemaVersion: "pcs-context-export-v1", generatedAt: now(), content: rendered.content, target, format: storedFormat(target), estimatedTokens: estimateTokens(rendered.content), maximumCharacters: maximumCharacters ?? null, maximumTokens: maximumTokens ?? null, previewFingerprint, omittedCount, omitted, includedCount: rendered.includedFields, destination, profile };
}

function validTimestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function ftsTerms(value: string) { return value.trim().split(/\s+/).map((term) => term.replaceAll('"', "")).filter(Boolean).slice(0, 12).map((term) => `"${term}"`).join(" AND "); }
function destinationHost(value: string) { try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase(); } catch { return ""; } }
function activeExternalAiConsent(scope: "document" | "field", providerId: string, host: string, documentId = "", templateId = "", fieldKey = "") { return Boolean(db.prepare("SELECT 1 FROM context_external_ai_consents WHERE scope=? AND provider_id=? AND destination_host=? AND document_id=? AND template_id=? AND field_key=? AND revoked_at IS NULL").get(scope, providerId, host, documentId, templateId, fieldKey)); }
function upsertDocument(inputPath: string) {
  const snapshot = readMarkdownSnapshot(notesRoot, inputPath);
  const existing = db.prepare("SELECT * FROM context_documents WHERE file_path=?").get(snapshot.relativePath) as any;
  const renamed = existing ? undefined : db.prepare("SELECT * FROM context_documents WHERE content_hash=? AND archived_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1").get(snapshot.contentHash) as any;
  const current = existing ?? renamed;
  const id = current?.id ?? newId("doc"), timestamp = now(), recordedAt = current?.recorded_at ?? snapshot.recordedAt;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (current) db.prepare("UPDATE context_documents SET file_path=?,title=?,source_updated_at=?,content_hash=?,file_size=?,updated_at=?,archived_at=NULL WHERE id=?").run(snapshot.relativePath, snapshot.title, snapshot.sourceUpdatedAt, snapshot.contentHash, snapshot.size, timestamp, id);
    else db.prepare("INSERT INTO context_documents(id,file_path,title,recorded_at,source_updated_at,content_hash,file_size,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(id, snapshot.relativePath, snapshot.title, recordedAt, snapshot.sourceUpdatedAt, snapshot.contentHash, snapshot.size, timestamp, timestamp);
    db.prepare("DELETE FROM context_document_fts WHERE document_id=?").run(id);
    db.prepare("INSERT INTO context_document_fts(document_id,title,body) VALUES(?,?,?)").run(id, snapshot.title, snapshot.content);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  provenance({ subjectType: "document", subjectId: id, eventType: current ? "reindexed" : "indexed", actorType: "system", sourceRef: snapshot.relativePath, sourceContentHash: snapshot.contentHash, metadata: { recordedAt, sourceUpdatedAt: snapshot.sourceUpdatedAt } });
  return { id, created: !current, renamed: Boolean(renamed), filePath: snapshot.relativePath, recordedAt, sourceUpdatedAt: snapshot.sourceUpdatedAt, contentHash: snapshot.contentHash };
}

function analysisSnapshot(startAt?: string, endAt?: string) {
  const lower = validTimestamp(startAt) ? startAt : "0000-01-01T00:00:00.000Z";
  const upper = validTimestamp(endAt) ? endAt : "9999-12-31T23:59:59.999Z";
  const rows = db.prepare("SELECT e.id AS entry_id,e.template_id,e.created_at,v.field_key,v.value_json,v.source_id,v.recorded_at,f.label,f.value_type,f.options_json,f.minimum_value,f.maximum_value,f.unit,f.analysis_role,f.analysis_role_confirmed,f.analysis_merge_allowed FROM context_entries e JOIN context_values v ON v.entry_id=e.id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' AND v.lifecycle_state='active' AND v.user_confirmed=1 AND v.sharing IN ('always','purpose_only') AND v.sensitivity!='highly_sensitive' AND v.recorded_at>=? AND v.recorded_at<=? ORDER BY v.recorded_at,e.id").all(lower, upper) as any[];
  const records = new Map<string, { id: string; recordedAt: string; title: string; sourceDocumentId: string | null; values: any[] }>();
  let invalid = 0;
  for (const row of rows) {
    let value: unknown;
    try { value = JSON.parse(row.value_json); } catch { invalid += 1; continue; }
    if (isSecretLike(typeof value === "string" ? value : JSON.stringify(value))) { invalid += 1; continue; }
    const record: { id: string; recordedAt: string; title: string; sourceDocumentId: string | null; values: any[] } = records.get(row.entry_id) ?? { id: row.entry_id, recordedAt: row.recorded_at, title: String(row.template_id), sourceDocumentId: typeof row.source_id === "string" && row.source_id.startsWith("doc_") ? row.source_id : null, values: [] };
    let allowedValues: Array<{ key: string; label: string }> | undefined;
    try { const options = JSON.parse(row.options_json); if (Array.isArray(options)) allowedValues = options.filter((item): item is { key: string; label: string } => Boolean(item) && typeof item.key === "string" && typeof item.label === "string"); } catch { /* an invalid option list is not exported */ }
    record.values.push({ fieldKey: row.field_key, label: row.label, valueType: row.value_type, value, templateId: row.template_id, sourceDocumentId: record.sourceDocumentId, allowedValues, analysisRole: row.analysis_role ?? undefined, analysisRoleConfirmed: Boolean(row.analysis_role_confirmed), analysisMergeAllowed: Boolean(row.analysis_merge_allowed), minimum: row.minimum_value ?? undefined, maximum: row.maximum_value ?? undefined, unit: row.unit ?? undefined });
    records.set(row.entry_id, record);
  }
  const unconfirmed = Number((db.prepare("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=0 AND v.recorded_at>=? AND v.recorded_at<=?").get(lower, upper) as any).count);
  const nonShareable = Number((db.prepare("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND (v.sharing IN ('private','never') OR v.sensitivity='highly_sensitive') AND v.recorded_at>=? AND v.recorded_at<=?").get(lower, upper) as any).count);
  return { schemaVersion: CONTEXT_ANALYSIS_SNAPSHOT_VERSION, generatedAt: now(), records: [...records.values()], excluded: { unconfirmed, nonShareable, invalid } };
}


function analysisSnapshotV2(profileId: string, startAt?: string, endAt?: string, timezone = "UTC") {
  const profile = db.prepare("SELECT id,purpose_id FROM context_profiles WHERE id=?").get(profileId) as { id: string; purpose_id: string | null } | undefined;
  if (!profile) throw new Error("pcs_profile_not_found");
  const selected = new Set((db.prepare("SELECT template_id,field_key FROM context_profile_fields WHERE profile_id=?").all(profileId) as Array<{ template_id: string; field_key: string }>).map((item) => `${item.template_id}:${item.field_key}`));
  const allowedPurposeValues = new Set((db.prepare("SELECT value_id FROM context_value_purposes WHERE purpose_id=?").all(profile.purpose_id ?? "") as Array<{ value_id: string }>).map((item) => item.value_id));
  const lower = validTimestamp(startAt) ? startAt! : new Date(Date.now() - 30 * 86400000).toISOString();
  const upper = validTimestamp(endAt) ? endAt! : new Date().toISOString();
  const rows = db.prepare("SELECT e.id AS entry_id,e.template_id,e.template_version,v.id AS value_id,v.field_key,v.value_json,v.source,v.source_id,v.user_confirmed,v.sharing,v.sensitivity,v.lifecycle_state,v.recorded_at,f.label,f.value_type,f.options_json,f.minimum_value,f.maximum_value,f.unit,f.analysis_role,f.analysis_role_confirmed,f.analysis_usage,f.analysis_merge_allowed FROM context_entries e JOIN context_values v ON v.entry_id=e.id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' AND v.recorded_at>=? AND v.recorded_at<=? ORDER BY v.recorded_at,e.id").all(lower, upper) as any[];
  const records = new Map<string, { id: string; recordedAt: string; title?: string; sourceDocumentId: string | null; values: any[] }>();
  const excluded = { unconfirmed: 0, nonShareable: 0, highlySensitive: 0, invalid: 0 };
  const supported = new Set(["boolean", "single_choice", "number", "integer", "scale", "duration_minutes"]);
  for (const row of rows) {
    if (!selected.has(`${row.template_id}:${row.field_key}`)) continue;
    if (!row.user_confirmed) { excluded.unconfirmed += 1; continue; }
    if (row.sensitivity === "highly_sensitive") { excluded.highlySensitive += 1; continue; }
    if (row.sharing === "private" || row.sharing === "never" || row.lifecycle_state === "retracted") { excluded.nonShareable += 1; continue; }
    let value: unknown;
    try { value = JSON.parse(row.value_json); } catch { excluded.invalid += 1; continue; }
    if (isSecretLike(typeof value === "string" ? value : JSON.stringify(value)) || !supported.has(row.value_type) || !row.analysis_role_confirmed || !row.analysis_role || !["condition", "outcome", "both", "excluded"].includes(row.analysis_usage ?? "excluded")) { excluded.invalid += 1; continue; }
    if (row.analysis_usage === "excluded") { excluded.invalid += 1; continue; }
    const record: { id: string; recordedAt: string; title?: string; sourceDocumentId: string | null; values: any[] } = records.get(row.entry_id) ?? { id: row.entry_id, recordedAt: row.recorded_at, title: String(row.template_id), sourceDocumentId: typeof row.source_id === "string" && row.source_id.startsWith("doc_") ? row.source_id : null, values: [] };
    let allowedValues: Array<{ key: string; label: string }> | undefined;
    try { const options = JSON.parse(row.options_json); if (Array.isArray(options)) allowedValues = options.filter((item): item is { key: string; label: string } => Boolean(item) && typeof item.key === "string" && typeof item.label === "string"); } catch { excluded.invalid += 1; continue; }
    const source = row.source === "user_input" ? "user_input" : row.source === "manual_import" ? "manual_import" : "manual_import";
    record.values.push({
      fieldKey: row.field_key, label: row.label, valueType: row.value_type, value,
      templateId: row.template_id, templateVersionId: String(row.template_version),
      analysisRole: row.analysis_role, analysisRoleConfirmed: true, analysisUsage: row.analysis_usage,
      analysisMergeAllowed: Boolean(row.analysis_merge_allowed), scaleFingerprint: [row.value_type, row.minimum_value ?? "", row.maximum_value ?? "", row.unit ?? "", JSON.stringify(allowedValues ?? [])].join("|"),
      unit: row.unit ?? undefined, minimum: row.minimum_value ?? undefined, maximum: row.maximum_value ?? undefined, allowedValues,
      provenance: { source, sourceId: row.source_id ?? row.entry_id, userConfirmed: true, recordedAt: row.recorded_at, transformVersion: "pcs-v2", privacyLevel: row.sensitivity === "sensitive" ? "sensitive" : "normal" }
    });
    records.set(row.entry_id, record);
  }
  return { schemaVersion: "pcs-analysis-snapshot-v2", snapshotId: `pcs_snapshot_${profileId}_${lower}_${upper}`, profileId, generatedAt: now(), period: { startAt: lower, endAt: upper, timezone }, records: [...records.values()], excluded };
}

function candidateStale(entryId: string) {
  const candidate = db.prepare("SELECT c.source_content_hash,d.content_hash,d.archived_at FROM context_entry_candidates c JOIN context_documents d ON d.id=c.document_id WHERE c.entry_id=?").get(entryId) as any;
  return Boolean(candidate && (candidate.archived_at || candidate.source_content_hash !== candidate.content_hash));
}

function recordReview(entryId: string, fieldKey: string, decision: "accepted" | "edited_and_accepted" | "rejected" | "unknown", reason: string, value?: unknown, reconfirmAfter?: unknown) {
  const current = valueRow(entryId, fieldKey);
  if (!current || current.user_confirmed || current.reviewed_at) throw new Error("review_value_not_pending");
  if (candidateStale(entryId)) throw new Error("extraction_stale");
  const timestamp = now();
  if (decision === "accepted" || decision === "edited_and_accepted") {
    const revision = addRevision({ entryId, fieldKey, value: value === undefined ? JSON.parse(current.value_json) : value, changeType: "initial", reason, reconfirmAfter });
    db.prepare("INSERT INTO context_value_reviews(id,value_id,entry_id,field_key,decision,reason,reviewed_at) VALUES(?,?,?,?,?,?,?)").run(newId("review"), current.id, entryId, fieldKey, decision, reason, timestamp);
    provenance({ subjectType: "value", subjectId: current.id, eventType: "reviewed", actorType: "user", sourceRef: current.source_id, sourceContentHash: revisionSourceHash(entryId), metadata: { entryId, fieldKey, decision } });
    audit("review_context_value", { entryId, fieldKey, decision });
    return { decision, ...revision };
  }
  db.prepare("UPDATE context_values SET reviewed_at=?,updated_at=? WHERE id=?").run(timestamp, timestamp, current.id);
  db.prepare("INSERT INTO context_value_reviews(id,value_id,entry_id,field_key,decision,reason,reviewed_at) VALUES(?,?,?,?,?,?,?)").run(newId("review"), current.id, entryId, fieldKey, decision, reason, timestamp);
  provenance({ subjectType: "value", subjectId: current.id, eventType: "reviewed", actorType: "user", sourceRef: current.source_id, sourceContentHash: revisionSourceHash(entryId), metadata: { entryId, fieldKey, decision } });
  audit("review_context_value", { entryId, fieldKey, decision });
  return { decision, reviewRequired: false };
}

function detectConflicts(entryId: string, fieldKey: string) {
  const candidate = db.prepare("SELECT document_id FROM context_entry_candidates WHERE entry_id=?").get(entryId) as { document_id: string } | undefined;
  const template = db.prepare("SELECT template_id FROM context_entries WHERE id=?").get(entryId) as { template_id: string } | undefined;
  if (!candidate || !template) return;
  const values = db.prepare("SELECT v.id,v.value_json FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_entry_candidates c ON c.entry_id=e.id WHERE c.document_id=? AND e.template_id=? AND v.field_key=? AND v.lifecycle_state='active'").all(candidate.document_id, template.template_id, fieldKey) as Array<{ id: string; value_json: string }>;
  if (new Set(values.map((value) => value.value_json)).size < 2) return;
  const conflictKey = createHash("sha256").update(`${candidate.document_id}:${template.template_id}:${fieldKey}:${values.map((value) => value.id).sort().join(",")}`).digest("hex");
  const existing = db.prepare("SELECT 1 FROM context_conflicts WHERE status='unresolved' AND field_keys_json=? AND value_ids_json=?").get(JSON.stringify([fieldKey]), JSON.stringify(values.map((value) => value.id).sort()));
  if (!existing) {
    db.prepare("INSERT INTO context_conflicts(id,field_keys_json,value_ids_json,status,created_at) VALUES(?,?,?,?,?)").run(`conflict_${conflictKey.slice(0, 24)}`, JSON.stringify([fieldKey]), JSON.stringify(values.map((value) => value.id).sort()), "unresolved", now());
    audit("detect_context_conflict", { entryId, fieldKey, valueCount: values.length });
  }
}

function dashboardValues() { return db.prepare("SELECT v.id AS value_id,v.entry_id,v.field_key,v.value_json,v.user_confirmed,v.sharing,v.sensitivity,v.lifecycle_state,v.current_revision_id,v.recorded_at,v.updated_at,e.template_id,t.name AS template_name,f.label FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_templates t ON t.id=e.template_id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' ORDER BY v.updated_at DESC").all(); }
function dashboardOverview() { const count = (sql: string) => Number((db.prepare(sql).get() as { count: number }).count); return { confirmedValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=1 AND v.lifecycle_state='active'"), pendingValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=0"), shareableValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=1 AND v.lifecycle_state='active' AND v.sharing IN ('always','purpose_only') AND v.sensitivity!='highly_sensitive'"), retractedValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.lifecycle_state='retracted'") }; }

export const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, service: "personal-context-studio" });
    if (request.method === "GET" && url.pathname === "/") { const bootstrap = adminToken ? "<script>(()=>{const token=sessionStorage.getItem('pcs-admin-token')||prompt('PCS admin token:','');if(token){sessionStorage.setItem('pcs-admin-token',token);const originalFetch=window.fetch;window.fetch=(input,init={})=>{const headers=new Headers(init.headers||{});headers.set('x-pcs-admin-token',token);return originalFetch(input,{...init,headers})}})();</script>" : ""; response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return response.end(dashboardHtml.replace("<script>", `${bootstrap}<script>`)); }
    if (url.pathname.startsWith("/v1/") && !isIntegrationRequest(request.method, url.pathname) && !managementAuthorized(request, adminToken)) return send(response, 401, { error: "management_authorization_required" });
    if (request.method === "GET" && url.pathname === "/v1/dashboard/overview") return send(response, 200, dashboardOverview());
    if (request.method === "GET" && url.pathname === "/v1/dashboard/values") return send(response, 200, { items: dashboardValues() });
    if (request.method === "GET" && url.pathname === "/v1/dashboard/audit") return send(response, 200, { items: db.prepare("SELECT id,action,summary_json,created_at FROM privacy_audit_logs ORDER BY created_at DESC LIMIT 100").all() });
    if (request.method === "GET" && url.pathname === "/v1/watcher/status") { try { return send(response, 200, JSON.parse(readFileSync(watcherStatePath, "utf8"))); } catch { return send(response, 404, { error: "watcher_status_unavailable" }); } }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "provenance") { const values = db.prepare("SELECT id FROM context_values WHERE entry_id=?").all(parts[2]) as Array<{ id: string }>; const ids = [parts[2], ...values.map((value) => value.id)]; const placeholders = ids.map(() => "?").join(","); return send(response, 200, { items: db.prepare(`SELECT subject_type,subject_id,event_type,actor_type,source_ref,source_content_hash,provider_id,model,payload_hash,metadata_json,created_at FROM context_provenance WHERE subject_id IN (${placeholders}) ORDER BY created_at DESC`).all(...ids) }); }
    if (request.method === "GET" && url.pathname === "/v1/integration-clients") return send(response, 200, { items: db.prepare("SELECT id,name,permissions_json,is_active,created_at,updated_at FROM integration_clients ORDER BY created_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/integration-clients") { const input = await body(request); const name = text(input.name); const permissions = Array.isArray(input.permissions) ? input.permissions.filter((item): item is IntegrationPermission => typeof item === "string" && (integrationPermissions as readonly string[]).includes(item)) : []; if (!name || !permissions.length) return send(response, 400, { error: "integration_client_invalid" }); const id = newId("client"), token = randomBytes(32).toString("base64url"), timestamp = now(); db.prepare("INSERT INTO integration_clients(id,name,token_hash,permissions_json,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id,name,hashIntegrationToken(token),JSON.stringify([...new Set(permissions)]),1,timestamp,timestamp); audit("create_integration_client", { clientId:id, permissions }); return send(response,201,{id,name,permissions,token}); }
    if (request.method === "POST" && parts.join("/").match(/^v1\/integration-clients\/[^/]+\/revoke$/)) { const result=db.prepare("UPDATE integration_clients SET is_active=0,updated_at=? WHERE id=? AND is_active=1").run(now(),parts[2]); audit("revoke_integration_client",{clientId:parts[2]}); return result.changes?send(response,200,{revoked:true}):send(response,404,{error:"integration_client_not_found"}); }
    if (request.method === "GET" && url.pathname === "/v1/documents") return send(response, 200, { items: db.prepare("SELECT id,file_path,title,recorded_at,source_updated_at,content_hash,file_size,created_at,updated_at FROM context_documents WHERE archived_at IS NULL ORDER BY recorded_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/documents") {
      const input = await body(request); const filePath = text(input.filePath); if (!filePath) return send(response, 400, { error: "document_path_required" });
      const result = upsertDocument(filePath); return send(response, result.created ? 201 : 200, result);
    }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "documents" && parts.length === 3) { const item = db.prepare("SELECT * FROM context_documents WHERE id=? AND archived_at IS NULL").get(parts[2]); return item ? send(response, 200, { item }) : send(response, 404, { error: "document_not_found" }); }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "documents" && parts[2] && parts[3] === "excerpt") { const item = db.prepare("SELECT file_path FROM context_documents WHERE id=? AND archived_at IS NULL").get(parts[2]) as any; if (!item) return send(response, 404, { error: "document_not_found" }); const snapshot = readMarkdownSnapshot(notesRoot, item.file_path); return send(response, 200, { documentId: parts[2], filePath: snapshot.relativePath, contentHash: snapshot.contentHash, excerpt: excerpt(snapshot.content, Number(url.searchParams.get("maxCharacters") ?? 2000)) }); }
    if (request.method === "DELETE" && parts[0] === "v1" && parts[1] === "documents" && parts[2]) { const timestamp = now(); db.exec("BEGIN IMMEDIATE"); try { const result = db.prepare("UPDATE context_documents SET archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL").run(timestamp, timestamp, parts[2]); db.prepare("DELETE FROM context_document_fts WHERE document_id=?").run(parts[2]); db.exec("COMMIT"); return result.changes ? send(response, 200, { archived: true }) : send(response, 404, { error: "document_not_found" }); } catch (error) { db.exec("ROLLBACK"); throw error; } }
    if (request.method === "POST" && url.pathname === "/v1/documents/search") {
      const input = await body(request); const terms = ftsTerms(text(input.query)); if (!terms) return send(response, 400, { error: "search_query_required" });
      const items = db.prepare("SELECT d.id,d.title,d.recorded_at,d.source_updated_at,snippet(context_document_fts,2,'','','...',18) AS snippet FROM context_document_fts JOIN context_documents d ON d.id=context_document_fts.document_id WHERE context_document_fts MATCH ? AND d.archived_at IS NULL ORDER BY rank LIMIT 50").all(terms);
      return send(response, 200, { items });
    }
    if (request.method === "GET" && url.pathname === "/v1/reviews/pending") { const items = db.prepare("SELECT e.id AS entry_id,e.template_id,c.document_id,c.source_content_hash,d.content_hash,d.file_path,COUNT(v.id) AS pending_values FROM context_entries e JOIN context_entry_candidates c ON c.entry_id=e.id JOIN context_documents d ON d.id=c.document_id JOIN context_values v ON v.entry_id=e.id AND v.user_confirmed=0 AND v.reviewed_at IS NULL WHERE e.status='active' GROUP BY e.id ORDER BY e.created_at DESC").all() as any[]; return send(response, 200, { items: items.map((item) => ({ ...item, stale: item.source_content_hash !== item.content_hash })) }); }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "reviews" && parts[2] === "entries" && parts[3]) { const item = db.prepare("SELECT e.id,c.document_id,c.provider,c.source_content_hash,d.content_hash,d.file_path FROM context_entries e JOIN context_entry_candidates c ON c.entry_id=e.id JOIN context_documents d ON d.id=c.document_id WHERE e.id=? AND e.status='active'").get(parts[3]) as any; if (!item) return send(response, 404, { error: "review_entry_not_found" }); const values = db.prepare("SELECT id,field_key,value_json,sharing,sensitivity,recorded_at FROM context_values WHERE entry_id=? AND user_confirmed=0 AND reviewed_at IS NULL ORDER BY field_key").all(parts[3]); return send(response, 200, { item: { ...item, stale: item.source_content_hash !== item.content_hash }, values }); }
    if (request.method === "GET" && url.pathname === "/v1/local-ai/status") { const [ollama, compatible, provider] = await Promise.all([detectOllama(), detectOpenAiCompatible(process.env.PCS_AI_BASE_URL), localAiProvider.healthCheck()]); return send(response, 200, { provider, runtimeState: localAiRuntime.state, ollama, openAiCompatible: compatible }); }
    if (request.method === "POST" && url.pathname === "/v1/local-ai/start") { await localAiRuntime.startWithRetry(1); return send(response, 200, { started: true, runtimeState: localAiRuntime.state }); }
    if (request.method === "POST" && url.pathname === "/v1/local-ai/stop") { await localAiRuntime.stop(); return send(response, 200, { stopped: true, runtimeState: localAiRuntime.state }); }
    if (request.method === "GET" && url.pathname === "/v1/privacy/external-ai-consents") return send(response, 200, { items: db.prepare("SELECT id,scope,provider_id,destination_host,document_id,template_id,field_key,granted_at,revoked_at FROM context_external_ai_consents ORDER BY granted_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/privacy/external-ai-consents") {
      const input = await body(request); const scope = text(input.scope); const providerId = text(input.providerId); const host = destinationHost(text(input.destinationHost)); const documentId = text(input.documentId); const templateId = text(input.templateId); const fieldKey = text(input.fieldKey);
      if (!providerId || !host || !["document", "field"].includes(scope) || (scope === "document" && !documentId) || (scope === "field" && (!templateId || !fieldKey))) return send(response, 400, { error: "external_ai_consent_invalid" });
      const id = newId("consent"), timestamp = now();
      db.prepare("INSERT INTO context_external_ai_consents(id,scope,provider_id,destination_host,document_id,template_id,field_key,granted_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,NULL) ON CONFLICT(scope,provider_id,destination_host,document_id,template_id,field_key) DO UPDATE SET granted_at=excluded.granted_at,revoked_at=NULL").run(id, scope, providerId, host, documentId, templateId, fieldKey, timestamp);
      audit("grant_external_ai_consent", { scope, providerId, destinationHost: host, documentId: documentId || undefined, templateId: templateId || undefined, fieldKey: fieldKey || undefined });
      const consent = db.prepare("SELECT id FROM context_external_ai_consents WHERE scope=? AND provider_id=? AND destination_host=? AND document_id=? AND template_id=? AND field_key=?").get(scope, providerId, host, documentId, templateId, fieldKey) as any;
      return send(response, 201, { id: consent.id, granted: true, scope, providerId, destinationHost: host });
    }
    if (request.method === "POST" && parts.join("/").match(/^v1\/privacy\/external-ai-consents\/[^/]+\/revoke$/)) { const result = db.prepare("UPDATE context_external_ai_consents SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(now(), parts[3]); return result.changes ? send(response, 200, { revoked: true }) : send(response, 404, { error: "external_ai_consent_not_found" }); }
    if (request.method === "POST" && url.pathname === "/v1/privacy/external-ai/authorize-extraction") {
      const input = await body(request); const documentId = text(input.documentId); const templateId = text(input.templateId); const providerId = text(input.providerId); const host = destinationHost(text(input.destinationHost));
      const document = db.prepare("SELECT id FROM context_documents WHERE id=? AND archived_at IS NULL").get(documentId); const fields = db.prepare("SELECT field_key,sharing_default,sensitivity FROM context_template_fields WHERE template_id=? ORDER BY display_order").all(templateId) as any[];
      if (!document || !templateId || !providerId || !host || !fields.length) return send(response, 400, { error: "external_ai_authorization_invalid" });
      const blockedFields = fields.filter((field) => field.sharing_default === "never" || field.sensitivity === "highly_sensitive").map((field) => field.field_key);
      const missing = [] as string[];
      if (!activeExternalAiConsent("document", providerId, host, documentId)) missing.push("document");
      for (const field of fields) if (!blockedFields.includes(field.field_key) && !activeExternalAiConsent("field", providerId, host, "", templateId, field.field_key)) missing.push(`field:${field.field_key}`);
      return send(response, 200, { allowed: !blockedFields.length && !missing.length, providerId, destinationHost: host, missing, blockedFields });
    }
    if (request.method === "GET" && url.pathname === "/v1/context/analysis-snapshot") { if (!integrationAuthorized(db,request,"read_snapshot")) return send(response,401,{error:"integration_authorization_required"}); const profileId = url.searchParams.get("profileId"); if (!profileId) return send(response,400,{error:"profile_required"}); return send(response, 200, analysisSnapshotV2(profileId, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("timezone") ?? "UTC")); }
    if (request.method === "GET" && url.pathname === "/v1/integration-template-requests") return send(response, 200, { items: db.prepare("SELECT id,source_system,source_request_id,source_reference_id,payload_json,status,template_id,created_at,updated_at FROM integration_template_requests ORDER BY created_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/integration-template-requests") { if (!integrationAuthorized(db,request,"submit_template_request")) return send(response,401,{error:"integration_authorization_required"});
      const input = validateIntegrationTemplateRequest(await body(request)); const existing = db.prepare("SELECT id,status,template_id FROM integration_template_requests WHERE source_system=? AND source_request_id=?").get(input.sourceSystem, input.id) as any;
      if (existing) return send(response, 200, { id: existing.id, status: existing.status, templateId: existing.template_id, duplicate: true });
      const id = newId("integration_request"); db.prepare("INSERT INTO integration_template_requests(id,source_system,source_request_id,source_reference_id,payload_json,status,template_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id, input.sourceSystem, input.id, input.sourceReferenceId, JSON.stringify(input), "pending", null, input.createdAt, now());
      audit("request_integration_template", { requestId: id, sourceSystem: input.sourceSystem, sourceReferenceId: input.sourceReferenceId });
      return send(response, 201, { id, sourceRequestId: input.id, status: "pending" });
    }
    if (request.method === "POST" && parts.join("/").match(/^v1\/integration-template-requests\/[^/]+\/create-template$/)) {
      const requestRecord = db.prepare("SELECT * FROM integration_template_requests WHERE id=? AND status='pending'").get(parts[2]) as any;
      if (!requestRecord) return send(response, 404, { error: "integration_template_request_not_found" });
      const requestInput = validateIntegrationTemplateRequest(JSON.parse(requestRecord.payload_json)) as IntegrationTemplateRequestV1;
      const requestedFields = requestInput.requestedFields.map((field, index) => validateField({ fieldKey: field.fieldKey, label: field.label, description: `Requested by ${requestInput.sourceSystem}.`, valueType: field.valueType, required: field.required, displayOrder: index + 1, options: field.options, sharingDefault: "purpose_only", sensitivity: "normal", reason: field.reason }));
      if (!requestedFields.length) return send(response, 400, { error: "integration_template_fields_required" });
      const templateId = newId("template"), timestamp = now(); db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO context_templates(id,name,description,purpose,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(templateId, requestInput.title, requestInput.purpose, `integration_${requestInput.sourceSystem}`, "draft", 1, timestamp, timestamp);
        const insert = db.prepare("INSERT INTO context_template_fields(id,template_id,field_key,label,description,value_type,required,display_order,options_json,sharing_default,sensitivity,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const field of requestedFields) insert.run(newId("field"), templateId, field.fieldKey, field.label, field.description ?? "", field.valueType, field.required ? 1 : 0, field.displayOrder, JSON.stringify(field.options ?? []), field.sharingDefault, field.sensitivity, field.reason);
        db.prepare("UPDATE integration_template_requests SET status='template_created',template_id=?,updated_at=? WHERE id=?").run(templateId, timestamp, parts[2]); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      audit("create_integration_template", { requestId: parts[2], templateId, sourceSystem: requestInput.sourceSystem });
      return send(response, 201, { requestId: parts[2], template: templateDetail(templateId) });
    }
    if (request.method === "POST" && url.pathname === "/v1/template-drafts/generate") {
      const input = await body(request); const theme = text(input.theme); if (!theme || theme.length > 300) return send(response, 400, { error: "template_theme_required" });
      const manualPrompt = localAiProvider.manualTemplatePrompt?.({ theme });
      if (manualPrompt) return send(response, 200, { mode: "manual", providerId: localAiProvider.id, prompt: manualPrompt });
      const draft = await localAiProvider.generateTemplateDraft({ theme });
      return send(response, 200, { mode: "local_ai", providerId: localAiProvider.id, draft });
    }
    if (request.method === "POST" && url.pathname === "/v1/template-drafts/validate") {
      const input = await body(request); const draft = validateTemplateDraft(input.draft ?? input); return send(response, 200, { valid: true, draft });
    }    if (request.method === "GET" && url.pathname === "/v1/context-templates") return send(response, 200, { items: db.prepare("SELECT * FROM context_templates WHERE status!='archived' ORDER BY updated_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/context-templates") {
      const input = await body(request); const name = text(input.name); const purpose = text(input.purpose) || "custom"; const rawFields = Array.isArray(input.fields) ? input.fields as ContextTemplateField[] : [];
      if (!name || !rawFields.length) return send(response, 400, { error: "template_invalid" });
      const validated = rawFields.map(validateField); const orders = new Set(validated.map((field) => field.displayOrder)); if (orders.size !== validated.length) return send(response, 400, { error: "template_field_order_invalid" });
      const id = newId("template"), createdAt = now(); db.exec("BEGIN IMMEDIATE"); try { db.prepare("INSERT INTO context_templates(id,name,description,purpose,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id, name, text(input.description), purpose, "draft", 1, createdAt, createdAt); const insert = db.prepare("INSERT INTO context_template_fields(id,template_id,field_key,label,description,value_type,required,display_order,options_json,minimum_value,maximum_value,unit,analysis_role,analysis_role_confirmed,analysis_usage,analysis_merge_allowed,sharing_default,sensitivity,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"); for (const field of validated) insert.run(newId("field"), id, field.fieldKey, field.label, field.description ?? "", field.valueType, field.required ? 1 : 0, field.displayOrder, JSON.stringify(field.options ?? []), field.minimum ?? null, field.maximum ?? null, field.unit ?? null, field.analysisRole ?? null, field.analysisRoleConfirmed ? 1 : 0, field.analysisUsage ?? "excluded", field.analysisMergeAllowed ? 1 : 0, field.sharingDefault, field.sensitivity, field.reason); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
      return send(response, 201, { item: templateDetail(id) });
    }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-templates" && parts[2]) { const item = templateDetail(parts[2]); return item ? send(response, 200, { item }) : send(response, 404, { error: "template_not_found" }); }    if (request.method === "POST" && parts.join("/").match(/^v1\/context-templates\/[^/]+\/new-version$/)) {
      const current = templateDetail(parts[2]); if (!current || current.status === "archived") return send(response, 404, { error: "template_not_found" });
      const input = await body(request); const rawFields = Array.isArray(input.fields) ? input.fields as ContextTemplateField[] : current.fields.map((field: any) => ({ fieldKey: field.field_key, label: field.label, description: field.description, valueType: field.value_type, required: Boolean(field.required), displayOrder: field.display_order, options: field.options, minimum: field.minimum_value ?? undefined, maximum: field.maximum_value ?? undefined, unit: field.unit ?? undefined, analysisRole: field.analysis_role ?? undefined, analysisRoleConfirmed: Boolean(field.analysis_role_confirmed), analysisUsage: field.analysis_usage, analysisMergeAllowed: Boolean(field.analysis_merge_allowed), sharingDefault: field.sharing_default, sensitivity: field.sensitivity, reason: field.reason }));
      const validated = rawFields.map(validateField); const id = newId("template"), createdAt = now(); db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO context_templates(id,name,description,purpose,status,version,parent_template_id,immutable,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, text(input.name) || current.name, text(input.description) || current.description, current.purpose, "draft", Number(current.version) + 1, current.id, 0, createdAt, createdAt);
        const insert = db.prepare("INSERT INTO context_template_fields(id,template_id,field_key,label,description,value_type,required,display_order,options_json,minimum_value,maximum_value,unit,analysis_role,analysis_role_confirmed,analysis_usage,analysis_merge_allowed,sharing_default,sensitivity,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const field of validated) insert.run(newId("field"), id, field.fieldKey, field.label, field.description ?? "", field.valueType, field.required ? 1 : 0, field.displayOrder, JSON.stringify(field.options ?? []), field.minimum ?? null, field.maximum ?? null, field.unit ?? null, field.analysisRole ?? null, field.analysisRoleConfirmed ? 1 : 0, field.analysisUsage ?? "excluded", field.analysisMergeAllowed ? 1 : 0, field.sharingDefault, field.sensitivity, field.reason);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      provenance({ subjectType: "template", subjectId: id, eventType: "draft_version_created", actorType: "user", sourceRef: current.id, metadata: { parentTemplateId: current.id, version: Number(current.version) + 1 } });
      return send(response, 201, { item: templateDetail(id), parentTemplateId: current.id });
    }
    if (request.method === "POST" && parts.join("/").match(/^v1\/context-templates\/[^/]+\/activate$/)) { const updated = db.prepare("UPDATE context_templates SET status='active',immutable=1,updated_at=? WHERE id=? AND status='draft'").run(now(), parts[2]); return updated.changes ? send(response, 200, { activated: true }) : send(response, 404, { error: "template_not_found_or_not_draft" }); }
    if (request.method === "POST" && parts.join("/").match(/^v1\/context-templates\/[^/]+\/archive$/)) { const updated = db.prepare("UPDATE context_templates SET status='archived',updated_at=? WHERE id=? AND status='draft'").run(now(), parts[2]); if (!updated.changes) return send(response, 404, { error: "template_not_found_or_not_draft" }); audit("archive_template", { templateId: parts[2] }); return send(response, 200, { archived: true }); }
    if (request.method === "POST" && url.pathname === "/v1/context-entries/candidates") {
      const input = await body(request); const template = templateDetail(text(input.templateId)); const values = input.values && typeof input.values === "object" ? input.values as Record<string, unknown> : null; const sourceDocumentId = text(input.sourceDocumentId);
      const document = sourceDocumentId ? db.prepare("SELECT id,recorded_at,content_hash FROM context_documents WHERE id=? AND archived_at IS NULL").get(sourceDocumentId) as any : null;
      if (!template || !values || !document) return send(response, 400, { error: "candidate_invalid" });
      const id = newId("entry"), timestamp = now(), recordedAt = validTimestamp(input.recordedAt) ? input.recordedAt : document.recorded_at;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO context_entries(id,template_id,template_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, template.id, template.version, "draft", timestamp, timestamp);
        const insert = db.prepare("INSERT INTO context_values(id,entry_id,field_key,value_json,source,source_id,user_confirmed,sharing,sensitivity,recorded_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
        for (const field of template.fields) {
          const value = values[field.field_key]; if (value === undefined) continue; if (isSecretLike(value)) throw new Error("secret_value_prohibited");
          const sharing = allowedSharing.has(text((input.sharing as any)?.[field.field_key]) as Sharing) ? (input.sharing as any)[field.field_key] : field.sharing_default;
          const sensitivity = allowedSensitivity.has(text((input.sensitivity as any)?.[field.field_key]) as Sensitivity) ? (input.sensitivity as any)[field.field_key] : field.sensitivity;
          insert.run(newId("value"), id, field.field_key, JSON.stringify(value), "manual_import", sourceDocumentId, 0, sharing, sensitivity, recordedAt, timestamp);
        }
        db.prepare("INSERT INTO context_entry_candidates(entry_id,document_id,source_content_hash,provider,created_at) VALUES(?,?,?,?,?)").run(id, sourceDocumentId, document.content_hash, text(input.provider) || "local", timestamp);
        db.prepare("UPDATE context_entries SET status='active',updated_at=? WHERE id=?").run(timestamp, id); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      audit("create_local_ai_candidate", { entryId: id, sourceDocumentId, provider: text(input.provider) || "local" });
      provenance({ subjectType: "entry", subjectId: id, eventType: "candidate_extracted", actorType: "local_ai", sourceRef: sourceDocumentId, sourceContentHash: document.content_hash, providerId: text(input.provider) || "local", model: text(input.model) || null, payload: values, metadata: { templateId: template.id, valueCount: Object.keys(values).length } });
      return send(response, 201, { id, reviewRequired: true });
    }
    if (request.method === "GET" && url.pathname === "/v1/context-entries") return send(response, 200, { items: db.prepare("SELECT * FROM context_entries WHERE status!='archived' ORDER BY updated_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/context-entries") {
      const input = await body(request); const template = templateDetail(text(input.templateId)); const values = input.values && typeof input.values === "object" ? input.values as Record<string, unknown> : null; if (!template || !values) return send(response, 400, { error: "entry_invalid" });
      const id = newId("entry"), createdAt = now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO context_entries(id,template_id,template_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, template.id, template.version, "draft", createdAt, createdAt);
        const insert = db.prepare("INSERT INTO context_values(id,entry_id,field_key,value_json,source,source_id,user_confirmed,sharing,sensitivity,recorded_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
        for (const field of template.fields) {
          const value = values[field.field_key]; if (field.required && (value === undefined || value === null || value === "")) throw new Error("required_context_value_missing"); if (value === undefined) continue; if (isSecretLike(value)) throw new Error("secret_value_prohibited");
          const sharing = allowedSharing.has(text((input.sharing as any)?.[field.field_key]) as Sharing) ? (input.sharing as any)[field.field_key] : field.sharing_default;
          const sensitivity = allowedSensitivity.has(text((input.sensitivity as any)?.[field.field_key]) as Sensitivity) ? (input.sensitivity as any)[field.field_key] : field.sensitivity;
          const valueId = newId("value"); insert.run(valueId, id, field.field_key, JSON.stringify(value), "user_input", null, 1, sharing, sensitivity, createdAt, createdAt); createInitialRevision(valueId);
        }
        db.prepare("UPDATE context_entries SET status='active',updated_at=? WHERE id=?").run(createdAt, id); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      audit("create_context_entry", { entryId: id }); provenance({ subjectType: "entry", subjectId: id, eventType: "created", actorType: "user", payload: values, metadata: { templateId: template.id, valueCount: Object.keys(values).length } }); return send(response, 201, { id });
    }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "values" && parts[4] && parts[5] === "revisions") {
      const value = valueRow(parts[2], parts[4]); if (!value) return send(response, 404, { error: "context_value_not_found" });
      const items = db.prepare("SELECT id,value_json,change_type,reason,valid_from,valid_to,sharing,sensitivity,supersedes_revision_id,source_id,source_content_hash,user_confirmed,confirmed_at,created_at FROM context_value_revisions WHERE value_id=? ORDER BY created_at DESC").all(value.id);
      return send(response, 200, { valueId: value.id, currentRevisionId: value.current_revision_id, lifecycleState: value.lifecycle_state, items });
    }
    if (request.method === "POST" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "values" && parts[4] && parts[5] === "revisions") {
      const input = await body(request); db.exec("BEGIN IMMEDIATE"); try { const result = addRevision({ entryId: parts[2], fieldKey: parts[4], value: input.value, changeType: text(input.changeType), reason: text(input.reason), validFrom: input.validFrom, validTo: input.validTo, sharing: input.sharing, sensitivity: input.sensitivity }); db.exec("COMMIT"); return send(response, 201, result); } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    if (request.method === "POST" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "values" && parts[4] && parts[5] === "review") { const input = await body(request); const decision = text(input.decision); if (!["accepted","edited_and_accepted","rejected","unknown"].includes(decision)) return send(response, 400, { error: "review_decision_invalid" }); const reason = text(input.reason) || `User marked this value ${decision}.`; db.exec("BEGIN IMMEDIATE"); try { const result = recordReview(parts[2], parts[4], decision as "accepted" | "edited_and_accepted" | "rejected" | "unknown", reason, input.value, input.reconfirmAfter); detectConflicts(parts[2], parts[4]); db.exec("COMMIT"); return send(response, 200, result); } catch (error) { db.exec("ROLLBACK"); throw error; } }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "values" && parts[4] && parts[5] === "reviews") return send(response, 200, { items: db.prepare("SELECT decision,reason,reviewed_at FROM context_value_reviews WHERE entry_id=? AND field_key=? ORDER BY reviewed_at DESC").all(parts[2], parts[4]) });
    if (request.method === "POST" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "values" && parts[4] && parts[5] === "reconfirm") { const input = await body(request); db.exec("BEGIN IMMEDIATE"); try { const result = addRevision({ entryId: parts[2], fieldKey: parts[4], changeType: "reaffirmation", reason: text(input.reason) || "Reconfirmed by user", reconfirmAfter: input.reconfirmAfter }); db.exec("COMMIT"); return send(response, 200, result); } catch (error) { db.exec("ROLLBACK"); throw error; } }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2]) { const item = db.prepare("SELECT * FROM context_entries WHERE id=? AND status!='archived'").get(parts[2]) as any; if (!item) return send(response, 404, { error: "entry_not_found" }); return send(response, 200, { item, values: db.prepare("SELECT id,field_key,value_json,source,source_id,user_confirmed,sharing,sensitivity,current_revision_id,lifecycle_state,recorded_at,updated_at FROM context_values WHERE entry_id=? ORDER BY field_key").all(parts[2]) }); }
    if (request.method === "PATCH" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2]) {
      const input = await body(request); const fieldKey = text(input.fieldKey); if (!fieldKey || isSecretLike(input.value)) return send(response, 400, { error: "context_value_invalid" }); const candidate = db.prepare("SELECT c.source_content_hash,d.content_hash,d.archived_at FROM context_entry_candidates c JOIN context_documents d ON d.id=c.document_id WHERE c.entry_id=?").get(parts[2]) as any; if (candidate && (candidate.archived_at || candidate.source_content_hash !== candidate.content_hash)) return send(response, 409, { error: "extraction_stale" });
      db.exec("BEGIN IMMEDIATE"); try { const result = addRevision({ entryId: parts[2], fieldKey, value: input.value, changeType: text(input.changeType), reason: text(input.reason), validFrom: input.validFrom, validTo: input.validTo, sharing: input.sharing, sensitivity: input.sensitivity, reconfirmAfter: input.reconfirmAfter }); detectConflicts(parts[2], fieldKey); db.exec("COMMIT"); return send(response, 200, { updated: true, ...result }); } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    if (request.method === "DELETE" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2]) { db.prepare("UPDATE context_entries SET status='archived',updated_at=? WHERE id=?").run(now(), parts[2]); audit("archive_entry", { entryId: parts[2] }); return send(response, 200, { archived: true }); }
    if (request.method === "GET" && url.pathname === "/v1/reconfirmations/due") return send(response, 200, { items: db.prepare("SELECT v.entry_id,v.field_key,v.value_json,v.reconfirm_after,f.label FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' AND v.user_confirmed=1 AND v.lifecycle_state='active' AND v.reconfirm_after IS NOT NULL AND v.reconfirm_after<=? ORDER BY v.reconfirm_after").all(now()) });
    if (request.method === "GET" && url.pathname === "/v1/context-conflicts") return send(response, 200, { items: db.prepare("SELECT * FROM context_conflicts WHERE status='unresolved' ORDER BY created_at DESC").all() });
    if (request.method === "POST" && parts[0] === "v1" && parts[1] === "context-conflicts" && parts[2] && parts[3] === "resolve") { const input = await body(request); const status = text(input.status); if (!["keep_latest","keep_both","resolved_manually"].includes(status)) return send(response, 400, { error: "conflict_resolution_invalid" }); const result = db.prepare("UPDATE context_conflicts SET status=?,resolved_at=? WHERE id=? AND status='unresolved'").run(status, now(), parts[2]); audit("resolve_context_conflict", { conflictId: parts[2], status }); return result.changes ? send(response, 200, { resolved: true, status }) : send(response, 404, { error: "context_conflict_not_found" }); }
    if (request.method === "GET" && url.pathname === "/v1/sharing-purposes") return send(response, 200, { items: db.prepare("SELECT * FROM context_sharing_purposes ORDER BY name").all() });
    if (request.method === "POST" && url.pathname === "/v1/sharing-purposes") { const input = await body(request); const name = text(input.name); if (!name || name.length > 120) return send(response, 400, { error: "sharing_purpose_invalid" }); const id = newId("purpose"), timestamp = now(); db.prepare("INSERT INTO context_sharing_purposes(id,name,description,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, name, text(input.description), 1, timestamp, timestamp); audit("create_sharing_purpose", { purposeId: id }); return send(response, 201, { id, name }); }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "values" && parts[4] && parts[5] === "purposes") { const value = valueRow(parts[2], parts[4]); if (!value) return send(response, 404, { error: "context_value_not_found" }); return send(response, 200, { items: db.prepare("SELECT p.* FROM context_sharing_purposes p JOIN context_value_purposes vp ON vp.purpose_id=p.id WHERE vp.value_id=? ORDER BY p.name").all(value.id) }); }
    if (request.method === "PUT" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2] && parts[3] === "values" && parts[4] && parts[5] === "purposes") { const input = await body(request); const value = valueRow(parts[2], parts[4]); const purposeIds = Array.isArray(input.purposeIds) ? [...new Set(input.purposeIds.filter((item): item is string => typeof item === "string" && validPurpose(item)))] : []; if (!value) return send(response, 404, { error: "context_value_not_found" }); db.exec("BEGIN IMMEDIATE"); try { db.prepare("DELETE FROM context_value_purposes WHERE value_id=?").run(value.id); const insert = db.prepare("INSERT INTO context_value_purposes(value_id,purpose_id,created_at) VALUES(?,?,?)"); for (const purposeId of purposeIds) insert.run(value.id, purposeId, now()); audit("set_value_sharing_purposes", { entryId: parts[2], fieldKey: parts[4], count: purposeIds.length }); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } return send(response, 200, { purposeIds }); }
    if (request.method === "GET" && url.pathname === "/v1/context-profiles") return send(response, 200, { items: db.prepare("SELECT * FROM context_profiles ORDER BY updated_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/context-profiles") {
      const input = await body(request); const selected = Array.isArray(input.includedFields) ? input.includedFields as Array<{ templateId: string; fieldKey: string }> : [];
      const purposeId = text(input.purposeId); const target = text(input.target) || "generic_ai_prompt"; const detailLevel = text(input.detailLevel) || "standard";
      const maximumCharacters = input.maximumCharacters === undefined || input.maximumCharacters === null || input.maximumCharacters === "" ? null : Number(input.maximumCharacters);
      const maximumTokens = input.maximumTokens === undefined || input.maximumTokens === null || input.maximumTokens === "" ? null : Number(input.maximumTokens);
      if (!text(input.name) || !selected.length || (purposeId && !validPurpose(purposeId)) || !["short","standard","detailed"].includes(detailLevel) || (maximumCharacters !== null && (!Number.isInteger(maximumCharacters) || maximumCharacters < 100)) || (maximumTokens !== null && (!Number.isInteger(maximumTokens) || maximumTokens < 25))) return send(response, 400, { error: "profile_invalid" });
      for (const item of selected) if (!db.prepare("SELECT 1 FROM context_template_fields WHERE template_id=? AND field_key=?").get(item.templateId, item.fieldKey)) return send(response, 400, { error: "profile_field_not_found" });
      const id = newId("profile"), createdAt = now(); db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO context_profiles(id,name,target,purpose_id,detail_level,maximum_characters,maximum_tokens,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id, text(input.name), target, purposeId || null, detailLevel, maximumCharacters, maximumTokens, createdAt, createdAt);
        const insert = db.prepare("INSERT INTO context_profile_fields(profile_id,template_id,field_key) VALUES(?,?,?)"); for (const item of selected) insert.run(id, item.templateId, item.fieldKey);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      audit("create_context_profile", { profileId: id, target, fieldCount: selected.length }); return send(response, 201, { id, target, maximumCharacters, maximumTokens });
    }    if (request.method === "POST" && url.pathname === "/v1/integration-imports") { if (!integrationAuthorized(db,request,"submit_import")) return send(response,401,{error:"integration_authorization_required"});
      const input = validateIntegrationImport(await body(request)); const existing = db.prepare("SELECT id,decision FROM integration_import_records WHERE source_system=? AND source_import_id=?").get(input.sourceSystem, input.id) as any;
      if (existing) return send(response, 200, { id: existing.id, decision: existing.decision, duplicate: true });
      const createdAt = input.createdAt ?? now(), id = newId("integration_import"); db.prepare("INSERT INTO integration_import_records(id,source_system,source_import_id,source_reference_id,payload_json,decision,target_template_id,target_field_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, input.sourceSystem, input.id, input.sourceReferenceId ?? null, JSON.stringify(input.payload), "pending", null, null, createdAt, now());
      audit("receive_integration_import", { importId: id, sourceSystem: input.sourceSystem, sourceReferenceId: input.sourceReferenceId ?? null }); provenance({ subjectType: "integration_import", subjectId: id, eventType: "received", actorType: "integration", sourceRef: input.sourceReferenceId ?? input.id, providerId: input.sourceSystem, payload: input.payload, metadata: { sourceImportId: input.id } }); return send(response, 201, { id, sourceImportId: input.id, decision: "pending" });
    }
    if (request.method === "GET" && url.pathname === "/v1/integration-imports") return send(response, 200, { items: db.prepare("SELECT * FROM integration_import_records ORDER BY created_at DESC").all() });
    if (request.method === "POST" && parts.join("/").match(/^v1\/integration-imports\/[^/]+\/decision$/)) { const input = await body(request); const decision = text(input.decision); if (!["accepted","edited_and_accepted","held","rejected"].includes(decision)) return send(response, 400, { error: "integration_import_decision_invalid" }); const result = db.prepare("UPDATE integration_import_records SET decision=?,target_template_id=?,target_field_key=?,updated_at=? WHERE id=?").run(decision, text(input.templateId) || null, text(input.fieldKey) || null, now(), parts[2]); audit("decide_integration_import", { importId: parts[2], decision }); return result.changes ? send(response, 200, { decision }) : send(response, 404, { error: "integration_import_not_found" }); }
    if (request.method === "POST" && (url.pathname === "/v1/context-exports/preview" || url.pathname === "/v1/context-exports")) {
      const input = await body(request); const format = text(input.format) || "markdown"; const target = text(input.target) || undefined; const destination = text(input.destination);
      if (destination.length > 200 || isSecretLike(destination)) return send(response, 400, { error: "export_request_invalid" });
      const preview = exportPreview(text(input.profileId), format, destination, { target, maximumCharacters: input.maximumCharacters, maximumTokens: input.maximumTokens });
      if (url.pathname.endsWith("preview")) return send(response, 200, preview);
      const id = newId("export"); const manifest = { schemaVersion: preview.schemaVersion, includedCount: preview.includedCount, omitted: preview.omitted, destination, target: preview.target, previewFingerprint: preview.previewFingerprint, maximumCharacters: preview.maximumCharacters, maximumTokens: preview.maximumTokens };
      db.prepare("INSERT INTO context_exports(id,profile_id,purpose_id,destination,format,target,preview_fingerprint,maximum_tokens,content,manifest_json,omitted_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, preview.profile.id, preview.profile.purpose_id ?? null, destination, preview.format, preview.target, preview.previewFingerprint, preview.maximumTokens, preview.content, JSON.stringify(manifest), preview.omittedCount, now());
      audit("export_context", { exportId: id, format: preview.format, target: preview.target, destination, omittedCount: preview.omittedCount }); provenance({ subjectType: "export", subjectId: id, eventType: "created", actorType: "user", sourceRef: preview.profile.id, payload: manifest, metadata: { format: preview.format, target: preview.target, includedCount: preview.includedCount, omittedCount: preview.omittedCount } }); return send(response, 201, { id, ...preview });
    }    if (request.method === "GET" && url.pathname === "/v1/context-exports") return send(response, 200, { items: db.prepare("SELECT id,profile_id,purpose_id,destination,format,target,preview_fingerprint,manifest_json,omitted_count,created_at FROM context_exports ORDER BY created_at DESC").all() });
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-exports" && parts[2]) { const item = db.prepare("SELECT * FROM context_exports WHERE id=?").get(parts[2]); return item ? send(response, 200, { item }) : send(response, 404, { error: "export_not_found" }); }
    if (request.method === "GET" && url.pathname === "/v1/backups") return send(response, 200, { items: db.prepare("SELECT * FROM context_backups ORDER BY created_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/backups") { mkdirSync(backupDirectory, { recursive: true }); const id = newId("backup"), fileName = `${id}.sqlite3`, filePath = resolve(backupDirectory, fileName); db.exec(`VACUUM INTO '${filePath.replaceAll("'", "''")}'`); const timestamp = now(), size = statSync(filePath).size, hash = fileHash(filePath); db.prepare("INSERT INTO context_backups(id,file_name,file_size,file_hash,created_at,verified_at) VALUES(?,?,?,?,?,?)").run(id, fileName, size, hash, timestamp, timestamp); audit("create_backup", { backupId: id, fileSize: size }); provenance({ subjectType: "backup", subjectId: id, eventType: "created", actorType: "system", sourceRef: fileName, sourceContentHash: hash, metadata: { fileSize: size } }); return send(response, 201, { id, fileName, fileSize: size, fileHash: hash, createdAt: timestamp }); }
    if (request.method === "POST" && parts[0] === "v1" && parts[1] === "backups" && parts[2] && parts[3] === "restore-plan") { const backup = db.prepare("SELECT * FROM context_backups WHERE id=?").get(parts[2]) as any; if (!backup) return send(response, 404, { error: "backup_not_found" }); const filePath = resolve(backupDirectory, backup.file_name); if (fileHash(filePath) !== backup.file_hash) return send(response, 409, { error: "backup_integrity_failed" }); const id = newId("restore_plan"), confirmation = `RESTORE ${parts[2]}`; db.prepare("INSERT INTO context_restore_plans(id,backup_id,confirmation_token,status,created_at) VALUES(?,?,?,?,?)").run(id, parts[2], confirmation, "planned", now()); return send(response, 200, { planId: id, backupId: parts[2], confirmation, restartRequired: true }); }
    if (request.method === "POST" && parts[0] === "v1" && parts[1] === "backups" && parts[2] && parts[3] === "restore") { const input = await body(request); const plan = db.prepare("SELECT p.*,b.file_name,b.file_hash FROM context_restore_plans p JOIN context_backups b ON b.id=p.backup_id WHERE p.id=? AND p.backup_id=? AND p.status='planned'").get(text(input.planId), parts[2]) as any; if (!plan || text(input.confirmation) !== plan.confirmation_token) return send(response, 400, { error: "restore_confirmation_required" }); const filePath = resolve(backupDirectory, plan.file_name); if (fileHash(filePath) !== plan.file_hash) return send(response, 409, { error: "backup_integrity_failed" }); const stagingPath = `${databasePath}.restore`; copyFileSync(filePath, stagingPath); db.prepare("UPDATE context_restore_plans SET status='executed',executed_at=? WHERE id=?").run(now(), plan.id); audit("restore_backup_scheduled", { backupId: parts[2], planId: plan.id }); send(response, 202, { restoring: true, restartRequired: true }); setTimeout(() => { try { db.close(); renameSync(databasePath, `${databasePath}.before-restore`); renameSync(stagingPath, databasePath); process.exit(0); } catch (error) { console.error(`Restore failed: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); } }, 100); return; }
    if (request.method === "POST" && url.pathname === "/v1/privacy/safe-delete/plan") {
      const input = await body(request); const entryId = text(input.entryId); const entry = db.prepare("SELECT template_id FROM context_entries WHERE id=? AND status!='archived'").get(entryId) as { template_id: string } | undefined;
      if (!entry) return send(response, 404, { error: "entry_not_found" });
      const values = Number((db.prepare("SELECT COUNT(*) AS count FROM context_values WHERE entry_id=?").get(entryId) as any).count);
      const revisions = Number((db.prepare("SELECT COUNT(*) AS count FROM context_value_revisions WHERE entry_id=?").get(entryId) as any).count);
      const candidates = Number((db.prepare("SELECT COUNT(*) AS count FROM context_entry_candidates WHERE entry_id=?").get(entryId) as any).count);
      const exports = Number((db.prepare("SELECT COUNT(*) AS count FROM context_exports WHERE profile_id IN (SELECT profile_id FROM context_profile_fields WHERE template_id=? AND field_key IN (SELECT field_key FROM context_values WHERE entry_id=?))").get(entry.template_id, entryId) as any).count);
      const planId = newId("delete_plan"), confirmation = `DELETE ${planId}`, summary = { values, revisions, candidates, exports };
      db.prepare("INSERT INTO privacy_safe_delete_plans(id,entry_id,confirmation_token,summary_json,status,created_at) VALUES(?,?,?,?,?,?)").run(planId, entryId, confirmation, JSON.stringify(summary), "planned", now());
      audit("plan_safe_delete", { entryId, planId, ...summary }); return send(response, 200, { planId, entryId, confirmation, summary, irreversible: true });
    }
    if (request.method === "POST" && url.pathname === "/v1/privacy/safe-delete/execute") {
      const input = await body(request); const planId = text(input.planId), entryId = text(input.entryId); const plan = db.prepare("SELECT * FROM privacy_safe_delete_plans WHERE id=? AND entry_id=? AND status='planned'").get(planId, entryId) as any;
      if (!plan || text(input.confirmation) !== plan.confirmation_token) return send(response, 400, { error: "safe_delete_confirmation_required" });
      const entry = db.prepare("SELECT template_id FROM context_entries WHERE id=?").get(entryId) as { template_id: string } | undefined; if (!entry) return send(response, 404, { error: "entry_not_found" });
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM context_exports WHERE profile_id IN (SELECT profile_id FROM context_profile_fields WHERE template_id=? AND field_key IN (SELECT field_key FROM context_values WHERE entry_id=?))").run(entry.template_id, entryId);
        db.prepare("DELETE FROM context_entries WHERE id=?").run(entryId);
        db.prepare("UPDATE privacy_safe_delete_plans SET status='executed',executed_at=? WHERE id=?").run(now(), planId);
        audit("safe_delete_entry", { entryId, planId, ...(JSON.parse(plan.summary_json) as Record<string, unknown>) }); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return send(response, 200, { deleted: true, entryId });
    }
    return send(response, 404, { error: "not_found" });
  } catch (error) { const message = error instanceof Error ? error.message : "request_failed"; const status = clientErrorStatus(message); return send(response, status ?? 500, { error: status ? message : "internal_error" }); }
});

export async function shutdown() {
  await localAiRuntime.stop();
  db.close();
}

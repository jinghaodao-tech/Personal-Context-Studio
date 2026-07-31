import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOmissionManifest, calculateReconfirmAfter, collectEligibleValues, eligibleForExport, evaluateDisclosure, isSecretLike, newId, validateContextValue, type ContextTemplateField, type Sharing, type Sensitivity } from "../../../packages/domain/src/index.ts";
import { CONTEXT_ANALYSIS_SNAPSHOT_VERSION } from "../../../packages/integration-contracts/src/index.ts";
import { excerpt, readMarkdownSnapshot } from "../../../packages/documents/src/index.ts";
import { createLocalAiProvider } from "../../../packages/ai-core/src/index.ts";
import { estimateTokens, normalizeExportTarget, renderTargetWithDetail, storedFormat, truncateRenderedTarget, type DetailLevel } from "../../../packages/export-renderers/src/index.ts";
import { RuntimeManager, detectOllama, detectOpenAiCompatible } from "../../../packages/local-ai-runtime/src/index.ts";
import { decryptText, encryptText, encryptionKey } from "../../../packages/crypto/src/index.ts";
import { dashboardHtml } from "./dashboardHtml.ts";
import { hashIntegrationToken, integrationAuthorization, integrationAuthorized, integrationPermissions, isIntegrationRequest, managementAuthorized } from "./integrationAccess.ts";
import { applyMigrations } from "./migrations.ts";
import { handleOperationsRoute } from "./routes/operations.ts";
import { handleGovernanceRoute } from "./routes/governance.ts";
import { handleContentRoute } from "./routes/content.ts";
import { handleTemplateRoute } from "./routes/templates.ts";
import { handleRuntimeRoute } from "./routes/runtime.ts";
import { handleProfileRoute } from "./routes/profiles.ts";
import { handleEntryRoute } from "./routes/entries.ts";
import { handleLifecycleRoute } from "./routes/lifecycle.ts";

const root = resolve(import.meta.dirname, "../../..");
const databasePath = process.env.PCS_DB ?? resolve(root, "data", "personal-context-studio.sqlite3");
const backupDirectory = resolve(process.env.PCS_BACKUP_DIR ?? resolve(dirname(databasePath), "backups"));
const watcherStatePath = resolve(process.env.PCS_WATCH_STATE ?? resolve(root, "data", "watcher-state.json"));
const adminToken = process.env.PCS_ADMIN_TOKEN;
if (process.env.PCS_REQUIRE_AUTH === "1" && (!adminToken || adminToken.length < 16)) throw new Error("admin_token_required");
const dataEncryptionKey = encryptionKey();
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
function storedValue(value: unknown, sensitivity: string) {
  const json = JSON.stringify(value);
  if (sensitivity === "normal") return { json, encrypted: 0 };
  if (!dataEncryptionKey) {
    if (sensitivity === "highly_sensitive") throw new Error("encryption_key_required");
    return { json, encrypted: 0 };
  }
  return { json: encryptText(json, dataEncryptionKey), encrypted: 1 };
}
function decodedJson(row: { value_json: string }) { return decryptText(row.value_json, dataEncryptionKey); }
function decodedValue(row: { value_json: string }) { return JSON.parse(decodedJson(row)); }
function fields(templateId: string) { return db.prepare("SELECT * FROM context_template_fields WHERE template_id=? ORDER BY display_order").all(templateId).map((field: any) => ({ ...field, required: Boolean(field.required), options: JSON.parse(field.options_json) })); }
function domainField(field: any): ContextTemplateField { return { fieldKey: field.field_key, label: field.label, description: field.description, valueType: field.value_type, required: Boolean(field.required), displayOrder: field.display_order, options: field.options, minimum: field.minimum_value ?? undefined, maximum: field.maximum_value ?? undefined, unit: field.unit ?? undefined, analysisRole: field.analysis_role ?? undefined, analysisRoleConfirmed: Boolean(field.analysis_role_confirmed), analysisUsage: field.analysis_usage, analysisMergeAllowed: Boolean(field.analysis_merge_allowed), reconfirmationMode: field.reconfirmation_mode ?? "none", reconfirmationIntervalDays: field.reconfirmation_interval_days ?? null, sharingDefault: field.sharing_default, sensitivity: field.sensitivity, reason: field.reason }; }
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
function defaultReconfirmAfter(entryId: string, fieldKey: string, timestamp = now()) {
  const field = db.prepare("SELECT f.reconfirmation_mode,f.reconfirmation_interval_days FROM context_entries e JOIN context_template_fields f ON f.template_id=e.template_id WHERE e.id=? AND f.field_key=?").get(entryId, fieldKey) as { reconfirmation_mode?: string; reconfirmation_interval_days?: number | null } | undefined;
  return field?.reconfirmation_mode === "default" && field.reconfirmation_interval_days ? calculateReconfirmAfter(timestamp, field.reconfirmation_interval_days) : null;
}

function addRevision(input: { entryId: string; fieldKey: string; value?: unknown; changeType?: string; reason?: string; validFrom?: unknown; validTo?: unknown; sharing?: unknown; sensitivity?: unknown; reconfirmAfter?: unknown }) {
  const current = valueRow(input.entryId, input.fieldKey);
  if (!current) throw new Error("context_value_not_found");
  const previousValue = decodedValue(current);
  const value = input.value === undefined ? previousValue : input.value;
  const definition = fields(current.template_id).find((field: any) => field.field_key === input.fieldKey);
  if (!definition) throw new Error("context_field_not_found");
  validateContextValue(domainField(definition), value);
  const changeType = (input.changeType || (current.user_confirmed ? "correction" : "initial")) as RevisionChangeType;
  if (!revisionChangeTypes.has(changeType)) throw new Error("revision_change_type_invalid");
  const reason = text(input.reason) || (changeType === "initial" ? "Initial confirmed value" : "");
  if (!reason || reason.length > 1000) throw new Error("revision_reason_required");
  const validFrom = input.validFrom === undefined || input.validFrom === null || input.validFrom === "" ? null : validTimestamp(input.validFrom) ? input.validFrom : (() => { throw new Error("revision_valid_from_invalid"); })();
  const validTo = input.validTo === undefined || input.validTo === null || input.validTo === "" ? null : validTimestamp(input.validTo) ? input.validTo : (() => { throw new Error("revision_valid_to_invalid"); })();
  if (validFrom && validTo && Date.parse(validFrom) >= Date.parse(validTo)) throw new Error("revision_valid_period_invalid");
  const sharing = allowedSharing.has(text(input.sharing) as Sharing) ? text(input.sharing) : current.sharing;
  const sensitivity = allowedSensitivity.has(text(input.sensitivity) as Sensitivity) ? text(input.sensitivity) : current.sensitivity;
  const timestamp = now();
  const reconfirmAfter = input.reconfirmAfter === undefined ? (current.reconfirm_after ?? defaultReconfirmAfter(input.entryId, input.fieldKey, timestamp)) : input.reconfirmAfter === null || input.reconfirmAfter === "" ? null : validTimestamp(input.reconfirmAfter) ? input.reconfirmAfter : (() => { throw new Error("reconfirm_after_invalid"); })();
  const stored = storedValue(value, sensitivity);
  const revisionId = newId("revision");
  if (changeType === "state_change" && validFrom && current.current_revision_id) db.prepare("UPDATE context_value_revisions SET valid_to=? WHERE id=? AND valid_to IS NULL").run(validFrom, current.current_revision_id);
  db.prepare("INSERT INTO context_value_revisions(id,value_id,entry_id,field_key,value_json,encrypted,change_type,reason,valid_from,valid_to,sharing,sensitivity,supersedes_revision_id,source_id,source_content_hash,user_confirmed,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(revisionId, current.id, input.entryId, input.fieldKey, stored.json, stored.encrypted, changeType, reason, validFrom, validTo, sharing, sensitivity, current.current_revision_id ?? null, current.source_id ?? null, revisionSourceHash(input.entryId), 1, timestamp, timestamp);
  db.prepare("UPDATE context_values SET value_json=?,encrypted=?,user_confirmed=1,reviewed_at=CASE WHEN user_confirmed=0 THEN ? ELSE reviewed_at END,last_reconfirmed_at=CASE WHEN user_confirmed=0 THEN ? ELSE last_reconfirmed_at END,reconfirm_after=?,sharing=?,sensitivity=?,current_revision_id=?,lifecycle_state=?,updated_at=? WHERE id=?").run(stored.json, stored.encrypted, timestamp, timestamp, reconfirmAfter, sharing, sensitivity, revisionId, changeType === "retraction" ? "retracted" : "active", timestamp, current.id);
  audit("revise_context_value", { entryId: input.entryId, fieldKey: input.fieldKey, revisionId, changeType, lifecycleState: changeType === "retraction" ? "retracted" : "active" });
  provenance({ subjectType: "value", subjectId: current.id, eventType: changeType === "initial" ? "confirmed" : "revised", actorType: "user", sourceRef: current.source_id, sourceContentHash: revisionSourceHash(input.entryId), metadata: { entryId: input.entryId, fieldKey: input.fieldKey, changeType } });
  return { revisionId, changeType, lifecycleState: changeType === "retraction" ? "retracted" : "active" };
}

function createInitialRevision(valueId: string, reason = "Initial confirmed value") {
  const row = db.prepare("SELECT v.*,e.status FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE v.id=?").get(valueId) as any;
  if (!row || !row.user_confirmed || row.current_revision_id || row.status === "archived") return;
  const revisionId = newId("revision"); const timestamp = now();
  db.prepare("INSERT INTO context_value_revisions(id,value_id,entry_id,field_key,value_json,encrypted,change_type,reason,valid_from,valid_to,sharing,sensitivity,supersedes_revision_id,source_id,source_content_hash,user_confirmed,confirmed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(revisionId, row.id, row.entry_id, row.field_key, row.value_json, row.encrypted ?? 0, "initial", reason, row.recorded_at, null, row.sharing, row.sensitivity, null, row.source_id ?? null, revisionSourceHash(row.entry_id), 1, timestamp, timestamp);
  db.prepare("UPDATE context_values SET current_revision_id=?,lifecycle_state=COALESCE(lifecycle_state,'active') WHERE id=?").run(revisionId, row.id);
}

for (const row of db.prepare("SELECT id FROM context_values WHERE user_confirmed=1 AND current_revision_id IS NULL").all() as Array<{ id: string }>) createInitialRevision(row.id, "Initial value migrated into revision history");
function exportPreview(profileId: string, format: string, destination = "", options: { target?: unknown; maximumCharacters?: unknown; maximumTokens?: unknown } = {}) {
  const profile = db.prepare("SELECT * FROM context_profiles WHERE id=? AND is_active=1").get(profileId) as any;
  if (!profile) throw new Error("profile_not_found");
  const selected = db.prepare("SELECT template_id,field_key FROM context_profile_fields WHERE profile_id=?").all(profileId) as Array<{ template_id: string; field_key: string }>;
  const placeholders = selected.length ? selected.map(() => "?").join(",") : "''";
  const rows = db.prepare(`SELECT v.*,f.label,e.template_id FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' AND v.lifecycle_state='active' AND (e.template_id || ':' || v.field_key) IN (${placeholders}) ORDER BY v.updated_at DESC`).all(...selected.map((item) => `${item.template_id}:${item.field_key}`)) as any[];
  const latest = new Map<string, any>(); for (const row of rows) if (!latest.has(`${row.template_id}:${row.field_key}`)) latest.set(`${row.template_id}:${row.field_key}`, row);
  const selectedValueIds = new Set([...latest.values()].map((row) => row.id));
  const unresolved = db.prepare("SELECT id,value_ids_json FROM context_conflicts WHERE status='unresolved'").all() as Array<{ id: string; value_ids_json: string }>;
  if (unresolved.some((conflict) => { try { return (JSON.parse(conflict.value_ids_json) as unknown[]).some((id) => selectedValueIds.has(String(id))); } catch { return false; } })) throw new Error("unresolved_context_conflict");
  const purposeIds = new Set((db.prepare("SELECT value_id FROM context_value_purposes WHERE purpose_id=?").all(profile.purpose_id ?? "") as Array<{ value_id: string }>).map((row) => row.value_id));
  const omitted = { unconfirmed: 0, retracted: 0, privateOrNever: 0, highlySensitive: 0, purposeNotAllowed: 0, invalid: 0, secretLike: 0, truncated: 0 };
  const safe = [...latest.values()].filter((row) => {
    let value: unknown;
    try { value = decodedValue(row); } catch { omitted.invalid += 1; return false; }
    const decision = evaluateDisclosure({ value, userConfirmed: Boolean(row.user_confirmed), lifecycleState: row.lifecycle_state, sharing: row.sharing, sensitivity: row.sensitivity, purposeAllowed: Boolean(profile.purpose_id && purposeIds.has(row.id)) });
    if (!decision.included) {
      if (decision.reason === "unconfirmed") omitted.unconfirmed += 1;
      if (decision.reason === "retracted") omitted.retracted += 1;
      if (decision.reason === "private_or_never") omitted.privateOrNever += 1;
      if (decision.reason === "highly_sensitive") omitted.highlySensitive += 1;
      if (decision.reason === "purpose_not_allowed") omitted.purposeNotAllowed += 1;
      if (decision.reason === "secret_like") omitted.secretLike += 1;
      return false;
    }
    return true;
  });
  const target = normalizeExportTarget(options.target ?? profile.target, format);
  const maximumCharacters = Number.isInteger(options.maximumCharacters) && Number(options.maximumCharacters) > 0 ? Number(options.maximumCharacters) : Number.isInteger(profile.maximum_characters) && profile.maximum_characters > 0 ? profile.maximum_characters : undefined;
  const maximumTokens = Number.isInteger(options.maximumTokens) && Number(options.maximumTokens) > 0 ? Number(options.maximumTokens) : Number.isInteger(profile.maximum_tokens) && profile.maximum_tokens > 0 ? profile.maximum_tokens : undefined;
  const detailLevel = (["short", "standard", "detailed"].includes(String(profile.detail_level)) ? String(profile.detail_level) : "standard") as DetailLevel;
  const renderFields = safe.map((row) => ({ label: row.label, fieldKey: row.field_key, value: decodedValue(row) }));
  const rendered = maximumCharacters || maximumTokens ? truncateRenderedTarget(renderFields, target, maximumCharacters, maximumTokens, detailLevel) : { content: renderTargetWithDetail(renderFields, target, detailLevel), truncated: false, includedFields: renderFields.length };
  if (rendered.truncated) omitted.truncated = 1;
  const omittedCount = Object.values(omitted).reduce((total, count) => total + count, 0);
  const previewFingerprint = createHash("sha256").update(JSON.stringify({ profileId, target, format: storedFormat(target), content: rendered.content, omitted, maximumCharacters, maximumTokens })).digest("hex");
  return { schemaVersion: "pcs-context-export-v1", rendererVersion: "pcs-renderer-v2", detailLevel, generatedAt: now(), content: rendered.content, target, format: storedFormat(target), estimatedTokens: estimateTokens(rendered.content), maximumCharacters: maximumCharacters ?? null, maximumTokens: maximumTokens ?? null, previewFingerprint, omittedCount, omitted, omissionManifest: buildOmissionManifest(omitted), includedCount: rendered.includedFields, destination, profile };
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
    try { value = decodedValue(row); } catch { invalid += 1; continue; }
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
  const profile = db.prepare("SELECT id,purpose_id FROM context_profiles WHERE id=? AND is_active=1").get(profileId) as { id: string; purpose_id: string | null } | undefined;
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
    const disclosure = evaluateDisclosure({ value: undefined, userConfirmed: Boolean(row.user_confirmed), lifecycleState: row.lifecycle_state, sharing: row.sharing, sensitivity: row.sensitivity, purposeAllowed: Boolean(profile.purpose_id && allowedPurposeValues.has(row.value_id)) });
    if (!disclosure.included) {
      if (disclosure.reason === "unconfirmed") excluded.unconfirmed += 1;
      else if (disclosure.reason === "highly_sensitive") excluded.highlySensitive += 1;
      else excluded.nonShareable += 1;
      continue;
    }
    let value: unknown;
    try { value = decodedValue(row); } catch { excluded.invalid += 1; continue; }
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
    const revision = addRevision({ entryId, fieldKey, value: value === undefined ? decodedValue(current) : value, changeType: "initial", reason, reconfirmAfter });
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
  if (new Set(values.map((value) => JSON.stringify(decodedValue(value)))).size < 2) return;
  const conflictKey = createHash("sha256").update(`${candidate.document_id}:${template.template_id}:${fieldKey}:${values.map((value) => value.id).sort().join(",")}`).digest("hex");
  const existing = db.prepare("SELECT 1 FROM context_conflicts WHERE status='unresolved' AND field_keys_json=? AND value_ids_json=?").get(JSON.stringify([fieldKey]), JSON.stringify(values.map((value) => value.id).sort()));
  if (!existing) {
    db.prepare("INSERT INTO context_conflicts(id,field_keys_json,value_ids_json,status,created_at) VALUES(?,?,?,?,?)").run(`conflict_${conflictKey.slice(0, 24)}`, JSON.stringify([fieldKey]), JSON.stringify(values.map((value) => value.id).sort()), "unresolved", now());
    audit("detect_context_conflict", { entryId, fieldKey, valueCount: values.length });
  }
}

function dashboardValues() { return (db.prepare("SELECT v.id AS value_id,v.entry_id,v.field_key,v.value_json,v.user_confirmed,v.sharing,v.sensitivity,v.lifecycle_state,v.current_revision_id,v.recorded_at,v.updated_at,e.template_id,t.name AS template_name,f.label FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_templates t ON t.id=e.template_id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' ORDER BY v.updated_at DESC").all() as any[]).map((value) => ({ ...value, value_json: decodedJson(value), purpose_ids: (db.prepare("SELECT purpose_id FROM context_value_purposes WHERE value_id=? ORDER BY purpose_id").all(value.value_id) as Array<{ purpose_id: string }>).map((item) => item.purpose_id) })); }
function dashboardOverview() { const count = (sql: string) => Number((db.prepare(sql).get() as { count: number }).count); return { confirmedValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=1 AND v.lifecycle_state='active'"), pendingValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=0"), shareableValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=1 AND v.lifecycle_state='active' AND v.sharing IN ('always','purpose_only') AND v.sensitivity!='highly_sensitive'"), retractedValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.lifecycle_state='retracted'") }; }

export const server = createServer(async (request, response) => {
  const requestId = typeof request.headers["x-request-id"] === "string" && request.headers["x-request-id"].length < 100 ? request.headers["x-request-id"] : randomUUID();
  response.setHeader("x-request-id", requestId);
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, service: "personal-context-studio" });
    if (request.method === "GET" && url.pathname === "/") { const bootstrap = adminToken ? "<script>(()=>{const token=sessionStorage.getItem('pcs-admin-token')||prompt('PCS admin token:','');if(token){sessionStorage.setItem('pcs-admin-token',token);const originalFetch=window.fetch;window.fetch=(input,init={})=>{const headers=new Headers(init.headers||{});headers.set('x-pcs-admin-token',token);return originalFetch(input,{...init,headers})}})();</script>" : ""; response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return response.end(dashboardHtml.replace("<script>", `${bootstrap}<script>`)); }
    if (request.method === "POST" && url.pathname === "/v1/auth/session") { if (!adminToken || !managementAuthorized(request, adminToken)) return send(response, 401, { error: "management_authorization_required" }); const token = randomBytes(32).toString("base64url"), timestamp = now(), expiresAt = new Date(Date.parse(timestamp) + 8 * 60 * 60 * 1000).toISOString(); db.prepare("INSERT INTO auth_sessions(id,token_hash,expires_at,created_at) VALUES(?,?,?,?)").run(newId("session"), hashIntegrationToken(token), expiresAt, timestamp); return send(response, 201, { token, expiresAt }); }
    if (request.method === "POST" && url.pathname === "/v1/auth/session/revoke") { const token = typeof request.headers["x-pcs-session-token"] === "string" ? request.headers["x-pcs-session-token"].trim() : ""; if (!token) return send(response, 400, { error: "session_token_required" }); const result = db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").run(now(), hashIntegrationToken(token)); return result.changes ? send(response, 200, { revoked: true }) : send(response, 404, { error: "session_not_found" }); }
    if (url.pathname.startsWith("/v1/") && !isIntegrationRequest(request.method, url.pathname) && !["/v1/auth/session", "/v1/auth/session/revoke"].includes(url.pathname) && !managementAuthorized(request, adminToken, db)) return send(response, 401, { error: "management_authorization_required" });
    if (await handleOperationsRoute(request, response, url, parts, { db, databasePath, backupDirectory, watcherStatePath, encryptionKey: dataEncryptionKey, send, now, newId, fileHash, audit, provenance })) return;
     if (await handleGovernanceRoute(request, response, url, parts, { db, send, body, text, now, newId, destinationHost, validPurpose, audit })) return;
     if (await handleRuntimeRoute(request, response, url, { db, send, body, text, activeExternalAiConsent, destinationHost, detectOllama, detectOpenAiCompatible, localAiProvider, localAiRuntime, analysisSnapshot: analysisSnapshotV2, integrationAuthorization })) return;
     if (await handleProfileRoute(request, response, url, parts, { db, send, body, text, now, newId, audit, validPurpose })) return;
     if (await handleEntryRoute(request, response, url, parts, { db, send, body, text, now, newId, audit, provenance, templateDetail, domainField, valueRow, decodedJson, storedValue, addRevision, recordReview, detectConflicts, createInitialRevision, validateContextValue, validTimestamp, calculateReconfirmAfter, isSecretLike, allowedSharing, allowedSensitivity })) return;
     if (await handleLifecycleRoute(request, response, url, parts, { db, send, body, text, now, audit, provenance, decodedJson, validPurpose, valueRow, newId, revisionSourceHash, exportPreview, isSecretLike })) return;
     if (await handleContentRoute(request, response, url, parts, { db, send, body, text, now, newId, audit, provenance, notesRoot, readMarkdownSnapshot, excerpt, ftsTerms, upsertDocument, integrationPermissions, integrationAuthorized, hashIntegrationToken, randomToken: () => randomBytes(32).toString("base64url"), decodedJson })) return;
     if (await handleTemplateRoute(request, response, url, parts, { db, send, body, text, now, newId, audit, provenance, templateDetail, integrationAuthorized, localAiProvider })) return;
    if (request.method === "GET" && url.pathname === "/v1/dashboard/overview") return send(response, 200, dashboardOverview());
    if (request.method === "GET" && url.pathname === "/v1/dashboard/values") return send(response, 200, { items: dashboardValues() });
    if (request.method === "GET" && url.pathname === "/v1/watcher/status") { try { return send(response, 200, JSON.parse(readFileSync(watcherStatePath, "utf8"))); } catch { return send(response, 404, { error: "watcher_status_unavailable" }); } }
    return send(response, 404, { error: "not_found" });
  } catch (error) { const message = error instanceof Error ? error.message : "request_failed"; const status = clientErrorStatus(message); return send(response, status ?? 500, { error: status ? message : "internal_error", requestId }); }
});

export async function shutdown() {
  await localAiRuntime.stop();
  db.close();
}

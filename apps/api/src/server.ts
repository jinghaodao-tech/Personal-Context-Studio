import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { eligibleForExport, formatExport, isSecretLike, newId, validateCandidate, validateField, type ContextTemplateField, type Sharing, type Sensitivity } from "../../../packages/domain/src/index.ts";
import { PCS_ANALYSIS_SNAPSHOT_VERSION, validateExperimentTemplateRequest, type ExperimentTemplateRequestV1 } from "../../../packages/metheory-bridge/src/index.ts";
import { excerpt, readMarkdownSnapshot } from "../../../packages/documents/src/index.ts";

const root = resolve(import.meta.dirname, "../../..");
const databasePath = process.env.PCS_DB ?? resolve(root, "data", "personal-context-studio.sqlite3");
const notesRoot = resolve(process.env.PCS_NOTES_DIR ?? resolve(root, "notes"));
mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(notesRoot, { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(readFileSync(resolve(root, "db", "schema.sql"), "utf8"));
const now = () => new Date().toISOString();
const allowedSharing = new Set<Sharing>(["always", "purpose_only", "private", "never"]);
const allowedSensitivity = new Set<Sensitivity>(["normal", "sensitive", "highly_sensitive"]);

function send(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { throw new Error("invalid_json"); } }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function fields(templateId: string) { return db.prepare("SELECT * FROM context_template_fields WHERE template_id=? ORDER BY display_order").all(templateId).map((field: any) => ({ ...field, required: Boolean(field.required), options: JSON.parse(field.options_json) })); }
function templateDetail(id: string) { const template = db.prepare("SELECT * FROM context_templates WHERE id=?").get(id) as any; return template ? { ...template, fields: fields(id) } : undefined; }
function audit(action: string, summary: unknown) { db.prepare("INSERT INTO privacy_audit_logs(id,action,summary_json,created_at) VALUES(?,?,?,?)").run(newId("audit"), action, JSON.stringify(summary), now()); }
function exportPreview(profileId: string, format: "markdown" | "json" | "agents" | "chatgpt") {
  const profile = db.prepare("SELECT * FROM context_profiles WHERE id=?").get(profileId) as any;
  if (!profile) throw new Error("profile_not_found");
  const selected = db.prepare("SELECT template_id,field_key FROM context_profile_fields WHERE profile_id=?").all(profileId) as Array<{ template_id: string; field_key: string }>;
  const placeholders = selected.length ? selected.map(() => "?").join(",") : "''";
  const rows = db.prepare(`SELECT v.*,f.label,e.template_id FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' AND (e.template_id || ':' || v.field_key) IN (${placeholders}) ORDER BY v.updated_at DESC`).all(...selected.map((item) => `${item.template_id}:${item.field_key}`)) as any[];
  const latest = new Map<string, any>(); for (const row of rows) if (!latest.has(`${row.template_id}:${row.field_key}`)) latest.set(`${row.template_id}:${row.field_key}`, row);
  const safe = [...latest.values()].filter((row) => eligibleForExport({ sharing: row.sharing, sensitivity: row.sensitivity, userConfirmed: Boolean(row.user_confirmed) }));
  const content = formatExport(safe.map((row) => ({ label: row.label, value: JSON.parse(row.value_json) })), format);
  const maximum = typeof profile.maximum_characters === "number" ? profile.maximum_characters : 12000;
  return { content: content.slice(0, maximum), omittedCount: latest.size - safe.length + (content.length > maximum ? 1 : 0), profile };
}

function validTimestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function ftsTerms(value: string) { return value.trim().split(/\s+/).map((term) => term.replaceAll('"', "")).filter(Boolean).slice(0, 12).map((term) => `"${term}"`).join(" AND "); }

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
  return { id, created: !current, renamed: Boolean(renamed), filePath: snapshot.relativePath, recordedAt, sourceUpdatedAt: snapshot.sourceUpdatedAt, contentHash: snapshot.contentHash };
}

function analysisSnapshot(startAt?: string, endAt?: string) {
  const lower = validTimestamp(startAt) ? startAt : "0000-01-01T00:00:00.000Z";
  const upper = validTimestamp(endAt) ? endAt : "9999-12-31T23:59:59.999Z";
  const rows = db.prepare("SELECT e.id AS entry_id,e.template_id,e.created_at,v.field_key,v.value_json,v.source_id,v.recorded_at,f.label,f.value_type,f.options_json FROM context_entries e JOIN context_values v ON v.entry_id=e.id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' AND v.user_confirmed=1 AND v.sharing IN ('always','purpose_only') AND v.sensitivity!='highly_sensitive' AND v.recorded_at>=? AND v.recorded_at<=? ORDER BY v.recorded_at,e.id").all(lower, upper) as any[];
  const records = new Map<string, { id: string; recordedAt: string; title: string; sourceDocumentId: string | null; values: any[] }>();
  let invalid = 0;
  for (const row of rows) {
    let value: unknown;
    try { value = JSON.parse(row.value_json); } catch { invalid += 1; continue; }
    if (isSecretLike(typeof value === "string" ? value : JSON.stringify(value))) { invalid += 1; continue; }
    const record: { id: string; recordedAt: string; title: string; sourceDocumentId: string | null; values: any[] } = records.get(row.entry_id) ?? { id: row.entry_id, recordedAt: row.recorded_at, title: String(row.template_id), sourceDocumentId: typeof row.source_id === "string" && row.source_id.startsWith("doc_") ? row.source_id : null, values: [] };
    let allowedValues: Array<{ key: string; label: string }> | undefined;
    try { const options = JSON.parse(row.options_json); if (Array.isArray(options)) allowedValues = options.filter((item): item is { key: string; label: string } => Boolean(item) && typeof item.key === "string" && typeof item.label === "string"); } catch { /* an invalid option list is not exported */ }
    record.values.push({ fieldKey: row.field_key, label: row.label, valueType: row.value_type, value, templateId: row.template_id, sourceDocumentId: record.sourceDocumentId, allowedValues });
    records.set(row.entry_id, record);
  }
  const unconfirmed = Number((db.prepare("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=0 AND v.recorded_at>=? AND v.recorded_at<=?").get(lower, upper) as any).count);
  const nonShareable = Number((db.prepare("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND (v.sharing IN ('private','never') OR v.sensitivity='highly_sensitive') AND v.recorded_at>=? AND v.recorded_at<=?").get(lower, upper) as any).count);
  return { schemaVersion: PCS_ANALYSIS_SNAPSHOT_VERSION, generatedAt: now(), records: [...records.values()], excluded: { unconfirmed, nonShareable, invalid } };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, service: "personal-context-studio" });
    if (request.method === "GET" && url.pathname === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return response.end("<!doctype html><title>Personal Context Studio</title><main><h1>Personal Context Studio</h1><p>Local-first personal context for AI sharing.</p><p>Use the local API or CLI to create templates, entries, profiles, imports, and exports.</p></main>"); }
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
    if (request.method === "GET" && url.pathname === "/v1/reviews/pending") { const items = db.prepare("SELECT e.id AS entry_id,e.template_id,c.document_id,c.source_content_hash,d.content_hash,d.file_path,COUNT(v.id) AS pending_values FROM context_entries e JOIN context_entry_candidates c ON c.entry_id=e.id JOIN context_documents d ON d.id=c.document_id JOIN context_values v ON v.entry_id=e.id AND v.user_confirmed=0 WHERE e.status='active' GROUP BY e.id ORDER BY e.created_at DESC").all() as any[]; return send(response, 200, { items: items.map((item) => ({ ...item, stale: item.source_content_hash !== item.content_hash })) }); }
    if (request.method === "GET" && url.pathname === "/v1/metheory/analysis-snapshot") return send(response, 200, analysisSnapshot(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined));
    if (request.method === "GET" && url.pathname === "/v1/experiment-template-requests") return send(response, 200, { items: db.prepare("SELECT id,source_system,source_hypothesis_id,payload_json,status,template_id,created_at,updated_at FROM experiment_template_requests ORDER BY created_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/experiment-template-requests") {
      const input = validateExperimentTemplateRequest(await body(request)); const existing = db.prepare("SELECT id,status,template_id FROM experiment_template_requests WHERE id=?").get(input.id) as any;
      if (existing) return send(response, 200, { id: existing.id, status: existing.status, templateId: existing.template_id, duplicate: true });
      db.prepare("INSERT INTO experiment_template_requests(id,source_system,source_hypothesis_id,payload_json,status,template_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(input.id, input.sourceSystem, input.hypothesisId, JSON.stringify(input), "pending", null, input.createdAt, now());
      audit("request_experiment_template", { requestId: input.id, hypothesisId: input.hypothesisId });
      return send(response, 201, { id: input.id, status: "pending" });
    }
    if (request.method === "POST" && parts.join("/").match(/^v1\/experiment-template-requests\/[^/]+\/create-template$/)) {
      const requestRecord = db.prepare("SELECT * FROM experiment_template_requests WHERE id=? AND status='pending'").get(parts[2]) as any;
      if (!requestRecord) return send(response, 404, { error: "experiment_template_request_not_found" });
      const requestInput = validateExperimentTemplateRequest(JSON.parse(requestRecord.payload_json)) as ExperimentTemplateRequestV1;
      const requestedFields = requestInput.requestedFields.map((field, index) => validateField({ fieldKey: field.fieldKey, label: field.label, description: "Requested by MeTheory for an experiment.", valueType: field.valueType, required: field.required, displayOrder: index + 1, options: field.options, sharingDefault: "purpose_only", sensitivity: "normal", reason: field.reason }));
      if (!requestedFields.length) return send(response, 400, { error: "experiment_template_fields_required" });
      const templateId = newId("template"), timestamp = now(); db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO context_templates(id,name,description,purpose,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(templateId, requestInput.title, requestInput.purpose, "metheory_experiment", "draft", 1, timestamp, timestamp);
        const insert = db.prepare("INSERT INTO context_template_fields(id,template_id,field_key,label,description,value_type,required,display_order,options_json,sharing_default,sensitivity,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const field of requestedFields) insert.run(newId("field"), templateId, field.fieldKey, field.label, field.description ?? "", field.valueType, field.required ? 1 : 0, field.displayOrder, JSON.stringify(field.options ?? []), field.sharingDefault, field.sensitivity, field.reason);
        db.prepare("UPDATE experiment_template_requests SET status='template_created',template_id=?,updated_at=? WHERE id=?").run(templateId, timestamp, parts[2]); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      audit("create_experiment_template", { requestId: parts[2], templateId });
      return send(response, 201, { requestId: parts[2], template: templateDetail(templateId) });
    }
    if (request.method === "GET" && url.pathname === "/v1/context-templates") return send(response, 200, { items: db.prepare("SELECT * FROM context_templates WHERE status!='archived' ORDER BY updated_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/context-templates") {
      const input = await body(request); const name = text(input.name); const purpose = text(input.purpose) || "custom"; const rawFields = Array.isArray(input.fields) ? input.fields as ContextTemplateField[] : [];
      if (!name || !rawFields.length) return send(response, 400, { error: "template_invalid" });
      const validated = rawFields.map(validateField); const orders = new Set(validated.map((field) => field.displayOrder)); if (orders.size !== validated.length) return send(response, 400, { error: "template_field_order_invalid" });
      const id = newId("template"), createdAt = now(); db.exec("BEGIN IMMEDIATE"); try { db.prepare("INSERT INTO context_templates(id,name,description,purpose,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id, name, text(input.description), purpose, "draft", 1, createdAt, createdAt); const insert = db.prepare("INSERT INTO context_template_fields(id,template_id,field_key,label,description,value_type,required,display_order,options_json,sharing_default,sensitivity,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"); for (const field of validated) insert.run(newId("field"), id, field.fieldKey, field.label, field.description ?? "", field.valueType, field.required ? 1 : 0, field.displayOrder, JSON.stringify(field.options ?? []), field.sharingDefault, field.sensitivity, field.reason); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
      return send(response, 201, { item: templateDetail(id) });
    }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-templates" && parts[2]) { const item = templateDetail(parts[2]); return item ? send(response, 200, { item }) : send(response, 404, { error: "template_not_found" }); }
    if (request.method === "POST" && parts.join("/").match(/^v1\/context-templates\/[^/]+\/activate$/)) { const updated = db.prepare("UPDATE context_templates SET status='active',updated_at=? WHERE id=? AND status='draft'").run(now(), parts[2]); return updated.changes ? send(response, 200, { activated: true }) : send(response, 404, { error: "template_not_found_or_not_draft" }); }
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
      return send(response, 201, { id, reviewRequired: true });
    }
    if (request.method === "GET" && url.pathname === "/v1/context-entries") return send(response, 200, { items: db.prepare("SELECT * FROM context_entries WHERE status!='archived' ORDER BY updated_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/context-entries") {
      const input = await body(request); const template = templateDetail(text(input.templateId)); const values = input.values && typeof input.values === "object" ? input.values as Record<string, unknown> : null; if (!template || !values) return send(response, 400, { error: "entry_invalid" });
      const id = newId("entry"), createdAt = now(); db.exec("BEGIN IMMEDIATE"); try { db.prepare("INSERT INTO context_entries(id,template_id,template_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, template.id, template.version, "draft", createdAt, createdAt); const insert = db.prepare("INSERT INTO context_values(id,entry_id,field_key,value_json,source,source_id,user_confirmed,sharing,sensitivity,recorded_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"); for (const field of template.fields) { const value = values[field.field_key]; if (field.required && (value === undefined || value === null || value === "")) throw new Error("required_context_value_missing"); if (value === undefined) continue; if (isSecretLike(value)) throw new Error("secret_value_prohibited"); const sharing = allowedSharing.has(text((input.sharing as any)?.[field.field_key]) as Sharing) ? (input.sharing as any)[field.field_key] : field.sharing_default; const sensitivity = allowedSensitivity.has(text((input.sensitivity as any)?.[field.field_key]) as Sensitivity) ? (input.sensitivity as any)[field.field_key] : field.sensitivity; insert.run(newId("value"), id, field.field_key, JSON.stringify(value), "user_input", null, 1, sharing, sensitivity, createdAt, createdAt); } db.prepare("UPDATE context_entries SET status='active',updated_at=? WHERE id=?").run(createdAt, id); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } return send(response, 201, { id });
    }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2]) { const item = db.prepare("SELECT * FROM context_entries WHERE id=? AND status!='archived'").get(parts[2]) as any; if (!item) return send(response, 404, { error: "entry_not_found" }); return send(response, 200, { item, values: db.prepare("SELECT id,field_key,value_json,source,source_id,user_confirmed,sharing,sensitivity,recorded_at,updated_at FROM context_values WHERE entry_id=? ORDER BY field_key").all(parts[2]) }); }
    if (request.method === "PATCH" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2]) { const input = await body(request); const fieldKey = text(input.fieldKey); if (!fieldKey || isSecretLike(input.value)) return send(response, 400, { error: "context_value_invalid" }); const candidate = db.prepare("SELECT c.source_content_hash,d.content_hash,d.archived_at FROM context_entry_candidates c JOIN context_documents d ON d.id=c.document_id WHERE c.entry_id=?").get(parts[2]) as any; if (candidate && (candidate.archived_at || candidate.source_content_hash !== candidate.content_hash)) return send(response, 409, { error: "extraction_stale" }); const result = db.prepare("UPDATE context_values SET value_json=?,user_confirmed=1,updated_at=? WHERE entry_id=? AND field_key=?").run(JSON.stringify(input.value), now(), parts[2], fieldKey); return result.changes ? send(response, 200, { updated: true }) : send(response, 404, { error: "context_value_not_found" }); }
    if (request.method === "DELETE" && parts[0] === "v1" && parts[1] === "context-entries" && parts[2]) { db.prepare("UPDATE context_entries SET status='archived',updated_at=? WHERE id=?").run(now(), parts[2]); audit("archive_entry", { entryId: parts[2] }); return send(response, 200, { archived: true }); }
    if (request.method === "GET" && url.pathname === "/v1/context-profiles") return send(response, 200, { items: db.prepare("SELECT * FROM context_profiles ORDER BY updated_at DESC").all() });
    if (request.method === "POST" && url.pathname === "/v1/context-profiles") { const input = await body(request); const selected = Array.isArray(input.includedFields) ? input.includedFields as Array<{ templateId: string; fieldKey: string }> : []; if (!text(input.name) || !selected.length) return send(response, 400, { error: "profile_invalid" }); const id = newId("profile"), createdAt = now(); db.exec("BEGIN IMMEDIATE"); try { db.prepare("INSERT INTO context_profiles(id,name,target,detail_level,maximum_characters,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, text(input.name), text(input.target) || "generic", text(input.detailLevel) || "standard", typeof input.maximumCharacters === "number" ? input.maximumCharacters : null, createdAt, createdAt); const insert = db.prepare("INSERT INTO context_profile_fields(profile_id,template_id,field_key) VALUES(?,?,?)"); for (const item of selected) insert.run(id, item.templateId, item.fieldKey); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } return send(response, 201, { id }); }
    if (request.method === "POST" && url.pathname === "/v1/context-imports/metheory") { const input = await body(request); const candidate = validateCandidate(input); const existing = db.prepare("SELECT id FROM context_import_records WHERE source_system='metheory' AND source_candidate_id=?").get(candidate.id) as any; if (existing) return send(response, 200, { id: existing.id, duplicate: true }); const id = newId("import"), createdAt = now(); db.prepare("INSERT INTO context_import_records(id,source_system,source_candidate_id,source_hypothesis_id,payload_json,decision,imported_at) VALUES(?,?,?,?,?,?,?)").run(id, "metheory", candidate.id, candidate.sourceHypothesisId, JSON.stringify(candidate), "pending", createdAt); audit("import_mettheory_candidate", { importId: id, sourceCandidateId: candidate.id }); return send(response, 201, { id, decision: "pending" }); }
    if (request.method === "GET" && url.pathname === "/v1/context-imports") return send(response, 200, { items: db.prepare("SELECT * FROM context_import_records ORDER BY imported_at DESC").all() });
    if (request.method === "POST" && parts.join("/").match(/^v1\/context-imports\/[^/]+\/decision$/)) { const input = await body(request); const decision = text(input.decision); if (!["accepted","edited_and_accepted","held","rejected"].includes(decision)) return send(response, 400, { error: "import_decision_invalid" }); const result = db.prepare("UPDATE context_import_records SET decision=?,target_template_id=?,target_field_key=? WHERE id=?").run(decision, text(input.templateId) || null, text(input.fieldKey) || null, parts[2]); audit("decide_import", { importId: parts[2], decision }); return result.changes ? send(response, 200, { decision }) : send(response, 404, { error: "import_not_found" }); }
    if (request.method === "POST" && (url.pathname === "/v1/context-exports/preview" || url.pathname === "/v1/context-exports")) { const input = await body(request); const format = text(input.format) as "markdown" | "json" | "agents" | "chatgpt"; if (!["markdown","json","agents","chatgpt"].includes(format)) return send(response, 400, { error: "export_format_invalid" }); const preview = exportPreview(text(input.profileId), format); if (url.pathname.endsWith("preview")) return send(response, 200, preview); const id = newId("export"); db.prepare("INSERT INTO context_exports(id,profile_id,format,content,omitted_count,created_at) VALUES(?,?,?,?,?,?)").run(id, preview.profile.id, format, preview.content, preview.omittedCount, now()); audit("export_context", { exportId: id, format, omittedCount: preview.omittedCount }); return send(response, 201, { id, ...preview }); }
    if (request.method === "GET" && parts[0] === "v1" && parts[1] === "context-exports" && parts[2]) { const item = db.prepare("SELECT * FROM context_exports WHERE id=?").get(parts[2]); return item ? send(response, 200, { item }) : send(response, 404, { error: "export_not_found" }); }
    if (request.method === "POST" && url.pathname === "/v1/privacy/safe-delete/plan") { const input = await body(request); const entryId = text(input.entryId); if (!entryId || !db.prepare("SELECT id FROM context_entries WHERE id=?").get(entryId)) return send(response, 404, { error: "entry_not_found" }); const planId = newId("delete_plan"); return send(response, 200, { planId, entryId, confirmation: `DELETE ${planId}`, irreversible: true }); }
    if (request.method === "POST" && url.pathname === "/v1/privacy/safe-delete/execute") { const input = await body(request); const planId = text(input.planId), entryId = text(input.entryId); if (!planId || text(input.confirmation) !== `DELETE ${planId}`) return send(response, 400, { error: "safe_delete_confirmation_required" }); db.exec("BEGIN IMMEDIATE"); try { db.prepare("DELETE FROM context_entries WHERE id=?").run(entryId); audit("safe_delete_entry", { entryId, planId }); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } return send(response, 200, { deleted: true, entryId }); }
    return send(response, 404, { error: "not_found" });
  } catch (error) { return send(response, 400, { error: error instanceof Error ? error.message : "request_failed" }); }
});
const port = Number(process.env.PCS_PORT ?? 8300);
server.listen(port, "127.0.0.1", () => console.log(`Personal Context Studio listening on http://127.0.0.1:${port}`));

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { validateIntegrationImport } from "../../../../packages/integration-contracts/src/index.ts";

export type ContentRouteContext = {
  db: DatabaseSync;
  send: (response: ServerResponse, status: number, value: unknown) => unknown;
  body: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  text: (value: unknown) => string;
  now: () => string;
  newId: (prefix: string) => string;
  audit: (action: string, summary: unknown) => void;
  provenance: (input: any) => void;
  notesRoot: string;
  readMarkdownSnapshot: (notesRoot: string, filePath: string) => { relativePath: string; contentHash: string; content: string };
  excerpt: (content: string, maxCharacters: number) => string;
  ftsTerms: (query: string) => string;
  upsertDocument: (filePath: string) => unknown;
  integrationPermissions: readonly string[];
  integrationAuthorized: (db: DatabaseSync, request: IncomingMessage, permission: "read_snapshot" | "submit_template_request" | "submit_import") => boolean;
  hashIntegrationToken: (token: string) => string;
  randomToken: () => string;
  decodedJson: (row: { value_json: string }) => unknown;
};

export async function handleContentRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  parts: string[],
  context: ContentRouteContext,
): Promise<boolean> {
  const { db, send, body, text, now, newId, audit, provenance, notesRoot, readMarkdownSnapshot, excerpt, ftsTerms, upsertDocument, integrationPermissions, integrationAuthorized, hashIntegrationToken, randomToken, decodedJson } = context;

  if (request.method === "GET" && url.pathname === "/v1/integration-clients") {
    const items = db.prepare("SELECT id,name,permissions_json,is_active,created_at,updated_at FROM integration_clients ORDER BY created_at DESC").all() as any[];
    send(response, 200, { items: items.map((client) => ({ ...client, allowedProfileIds: (db.prepare("SELECT profile_id FROM integration_client_profiles WHERE client_id=? ORDER BY profile_id").all(client.id) as Array<{ profile_id: string }>).map((row) => row.profile_id) })) }); return true;
  }
  if (request.method === "POST" && url.pathname === "/v1/integration-clients") {
    const input = await body(request); const name = text(input.name);
    const permissions = Array.isArray(input.permissions) ? input.permissions.filter((item): item is string => typeof item === "string" && integrationPermissions.includes(item)) : [];
    const allowedProfileIds = Array.isArray(input.allowedProfileIds) ? [...new Set(input.allowedProfileIds.filter((item): item is string => typeof item === "string" && Boolean(db.prepare("SELECT 1 FROM context_profiles WHERE id=?").get(item))))] : [];
    if (!name || !permissions.length) { send(response, 400, { error: "integration_client_invalid" }); return true; }
    const id = newId("client"), token = randomToken(), timestamp = now(); db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO integration_clients(id,name,token_hash,permissions_json,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, name, hashIntegrationToken(token), JSON.stringify([...new Set(permissions)]), 1, timestamp, timestamp);
      const insertScope = db.prepare("INSERT INTO integration_client_profiles(client_id,profile_id,created_at) VALUES(?,?,?)");
      for (const profileId of allowedProfileIds) insertScope.run(id, profileId, timestamp);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    audit("create_integration_client", { clientId: id, permissions, allowedProfileIds }); send(response, 201, { id, name, permissions, allowedProfileIds, token }); return true;
  }
  if (request.method === "POST" && parts.join("/").match(/^v1\/integration-clients\/[^/]+\/revoke$/)) {
    const result = db.prepare("UPDATE integration_clients SET is_active=0,updated_at=? WHERE id=? AND is_active=1").run(now(), parts[2]); audit("revoke_integration_client", { clientId: parts[2] }); send(response, result.changes ? 200 : 404, result.changes ? { revoked: true } : { error: "integration_client_not_found" }); return true;
  }

  if (request.method === "GET" && url.pathname === "/v1/documents") { send(response, 200, { items: db.prepare("SELECT id,file_path,title,recorded_at,source_updated_at,content_hash,file_size,created_at,updated_at FROM context_documents WHERE archived_at IS NULL ORDER BY recorded_at DESC").all() }); return true; }
  if (request.method === "POST" && url.pathname === "/v1/documents") { const input = await body(request); const filePath = text(input.filePath); if (!filePath) { send(response, 400, { error: "document_path_required" }); return true; } const result = upsertDocument(filePath) as any; send(response, result.created ? 201 : 200, result); return true; }
  if (request.method === "GET" && parts[0] === "v1" && parts[1] === "documents" && parts.length === 3) { const item = db.prepare("SELECT * FROM context_documents WHERE id=? AND archived_at IS NULL").get(parts[2]); send(response, item ? 200 : 404, item ? { item } : { error: "document_not_found" }); return true; }
  if (request.method === "GET" && parts[0] === "v1" && parts[1] === "documents" && parts[2] && parts[3] === "excerpt") { const item = db.prepare("SELECT file_path FROM context_documents WHERE id=? AND archived_at IS NULL").get(parts[2]) as any; if (!item) { send(response, 404, { error: "document_not_found" }); return true; } const snapshot = readMarkdownSnapshot(notesRoot, item.file_path); send(response, 200, { documentId: parts[2], filePath: snapshot.relativePath, contentHash: snapshot.contentHash, excerpt: excerpt(snapshot.content, Number(url.searchParams.get("maxCharacters") ?? 2000)) }); return true; }
  if (request.method === "DELETE" && parts[0] === "v1" && parts[1] === "documents" && parts[2]) { const timestamp = now(); db.exec("BEGIN IMMEDIATE"); try { const result = db.prepare("UPDATE context_documents SET archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL").run(timestamp, timestamp, parts[2]); db.prepare("DELETE FROM context_document_fts WHERE document_id=?").run(parts[2]); db.exec("COMMIT"); send(response, result.changes ? 200 : 404, result.changes ? { archived: true } : { error: "document_not_found" }); } catch (error) { db.exec("ROLLBACK"); throw error; } return true; }
  if (request.method === "POST" && url.pathname === "/v1/documents/search") { const input = await body(request); const terms = ftsTerms(text(input.query)); if (!terms) { send(response, 400, { error: "search_query_required" }); return true; } const mode = text(input.mode) === "hybrid" ? "hybrid" : "lexical"; const from = typeof input.from === "string" ? input.from : "0000-01-01T00:00:00.000Z"; const to = typeof input.to === "string" ? input.to : "9999-12-31T23:59:59.999Z"; const limit = Math.min(100, Math.max(1, Number(input.limit) || 50)); const order = mode === "hybrid" ? "(rank * 0.8) - (julianday(d.recorded_at) * 0.000001)" : "rank"; const items = db.prepare(`SELECT d.id,d.title,d.recorded_at,d.source_updated_at,snippet(context_document_fts,2,'','','...',18) AS snippet,rank AS lexical_rank,(${order}) AS hybrid_score FROM context_document_fts JOIN context_documents d ON d.id=context_document_fts.document_id WHERE context_document_fts MATCH ? AND d.archived_at IS NULL AND d.recorded_at>=? AND d.recorded_at<=? ORDER BY hybrid_score LIMIT ?`).all(terms, from, to, limit); send(response, 200, { mode, items }); return true; }

  if (request.method === "GET" && url.pathname === "/v1/reviews/pending") { const items = db.prepare("SELECT e.id AS entry_id,e.template_id,c.document_id,c.source_content_hash,d.content_hash,d.file_path,COUNT(v.id) AS pending_values FROM context_entries e JOIN context_entry_candidates c ON c.entry_id=e.id JOIN context_documents d ON d.id=c.document_id JOIN context_values v ON v.entry_id=e.id AND v.user_confirmed=0 AND v.reviewed_at IS NULL WHERE e.status='active' GROUP BY e.id ORDER BY e.created_at DESC").all() as any[]; send(response, 200, { items: items.map((item) => ({ ...item, stale: item.source_content_hash !== item.content_hash })) }); return true; }
  if (request.method === "GET" && parts[0] === "v1" && parts[1] === "reviews" && parts[2] === "entries" && parts[3]) { const item = db.prepare("SELECT e.id,c.document_id,c.provider,c.source_content_hash,d.content_hash,d.file_path FROM context_entries e JOIN context_entry_candidates c ON c.entry_id=e.id JOIN context_documents d ON d.id=c.document_id WHERE e.id=? AND e.status='active'").get(parts[3]) as any; if (!item) { send(response, 404, { error: "review_entry_not_found" }); return true; } const values = (db.prepare("SELECT id,field_key,value_json,sharing,sensitivity,recorded_at FROM context_values WHERE entry_id=? AND user_confirmed=0 AND reviewed_at IS NULL ORDER BY field_key").all(parts[3]) as any[]).map((value) => ({ ...value, value_json: decodedJson(value) })); send(response, 200, { item: { ...item, stale: item.source_content_hash !== item.content_hash }, values }); return true; }
  if (request.method === "POST" && url.pathname === "/v1/integration-imports") { if (!integrationAuthorized(db, request, "submit_import")) { send(response, 401, { error: "integration_authorization_required" }); return true; } const input = validateIntegrationImport(await body(request)); const existing = db.prepare("SELECT id,decision FROM integration_import_records WHERE source_system=? AND source_import_id=?").get(input.sourceSystem, input.id) as any; if (existing) { send(response, 200, { id: existing.id, decision: existing.decision, duplicate: true }); return true; } const createdAt = input.createdAt ?? now(), id = newId("integration_import"); db.prepare("INSERT INTO integration_import_records(id,source_system,source_import_id,source_reference_id,payload_json,decision,target_template_id,target_field_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, input.sourceSystem, input.id, input.sourceReferenceId ?? null, JSON.stringify(input.payload), "pending", null, null, createdAt, now()); audit("receive_integration_import", { importId: id, sourceSystem: input.sourceSystem, sourceReferenceId: input.sourceReferenceId ?? null }); provenance({ subjectType: "integration_import", subjectId: id, eventType: "received", actorType: "integration", sourceRef: input.sourceReferenceId ?? input.id, providerId: input.sourceSystem, payload: input.payload }); send(response, 201, { id, sourceImportId: input.id, decision: "pending" }); return true; }
  if (request.method === "GET" && url.pathname === "/v1/integration-imports") { send(response, 200, { items: db.prepare("SELECT * FROM integration_import_records ORDER BY created_at DESC").all() }); return true; }
  if (request.method === "POST" && parts.join("/").match(/^v1\/integration-imports\/[^/]+\/decision$/)) { const input = await body(request); const decision = text(input.decision); if (!["accepted", "edited_and_accepted", "held", "rejected"].includes(decision)) { send(response, 400, { error: "integration_import_decision_invalid" }); return true; } const result = db.prepare("UPDATE integration_import_records SET decision=?,target_template_id=?,target_field_key=?,updated_at=? WHERE id=?").run(decision, text(input.templateId) || null, text(input.fieldKey) || null, now(), parts[2]); audit("decide_integration_import", { importId: parts[2], decision }); send(response, result.changes ? 200 : 404, result.changes ? { decision } : { error: "integration_import_not_found" }); return true; }
  return false;
}

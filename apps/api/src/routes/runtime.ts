import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { PCS_ANALYSIS_CONTRACT_REVISION } from "../../../../packages/integration-contracts/src/index.ts";

export type RuntimeRouteContext = {
  db: DatabaseSync;
  send: (response: ServerResponse, status: number, value: unknown) => unknown;
  body: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  text: (value: unknown) => string;
  activeExternalAiConsent: (...args: any[]) => boolean;
  destinationHost: (value: string) => string;
  detectOllama: () => Promise<unknown>;
  detectOpenAiCompatible: (baseUrl?: string) => Promise<unknown>;
  localAiProvider: any;
  localAiRuntime: any;
  analysisSnapshot: (profileId: string, from?: string, to?: string, timezone?: string) => unknown;
  analysisSnapshotV3?: (profileId: string, from?: string, to?: string, timezone?: string) => unknown;
  integrationAuthorization: (...args: any[]) => { ok: boolean; status: number; error: string };
};

export async function handleRuntimeRoute(request: IncomingMessage, response: ServerResponse, url: URL, context: RuntimeRouteContext): Promise<boolean> {
  const { db, send, body, text, activeExternalAiConsent, destinationHost, detectOllama, detectOpenAiCompatible, localAiProvider, localAiRuntime, analysisSnapshot, analysisSnapshotV3, integrationAuthorization } = context;
  if (request.method === "GET" && url.pathname === "/v1/local-ai/status") { const [ollama, compatible, provider] = await Promise.all([detectOllama(), detectOpenAiCompatible(process.env.PCS_AI_BASE_URL), localAiProvider.healthCheck()]); send(response, 200, { provider, runtimeState: localAiRuntime.state, ollama, openAiCompatible: compatible }); return true; }
  if (request.method === "POST" && url.pathname === "/v1/local-ai/start") { await localAiRuntime.startWithRetry(1); send(response, 200, { started: true, runtimeState: localAiRuntime.state }); return true; }
  if (request.method === "POST" && url.pathname === "/v1/local-ai/stop") { await localAiRuntime.stop(); send(response, 200, { stopped: true, runtimeState: localAiRuntime.state }); return true; }
  if (request.method === "POST" && url.pathname === "/v1/privacy/external-ai/authorize-extraction") { const input = await body(request); const documentId = text(input.documentId); const templateId = text(input.templateId); const providerId = text(input.providerId); const host = destinationHost(text(input.destinationHost)); const document = db.prepare("SELECT id FROM context_documents WHERE id=? AND archived_at IS NULL").get(documentId); const fields = db.prepare("SELECT field_key,sharing_default,sensitivity FROM context_template_fields WHERE template_id=? ORDER BY display_order").all(templateId) as any[]; if (!document || !templateId || !providerId || !host || !fields.length) { send(response, 400, { error: "external_ai_authorization_invalid" }); return true; } const blockedFields = fields.filter((field) => field.sharing_default === "never" || field.sensitivity === "highly_sensitive").map((field) => field.field_key); const missing: string[] = []; if (!activeExternalAiConsent("document", providerId, host, documentId)) missing.push("document"); for (const field of fields) if (!blockedFields.includes(field.field_key) && !activeExternalAiConsent("field", providerId, host, "", templateId, field.field_key)) missing.push(`field:${field.field_key}`); send(response, 200, { allowed: !blockedFields.length && !missing.length, providerId, destinationHost: host, missing, blockedFields }); return true; }
  if (request.method === "GET" && url.pathname === "/v1/context/analysis-snapshot") { const profileId = url.searchParams.get("profileId"); const authorization = integrationAuthorization(db, request, "read_snapshot", profileId ?? undefined); if (!authorization.ok) { send(response, authorization.status, { error: authorization.error }); return true; } if (!profileId) { send(response, 400, { error: "profile_required" }); return true; } const snapshot = analysisSnapshot(profileId, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("timezone") ?? "UTC") as Record<string, unknown>; send(response, 200, { ...snapshot, contractRevision: PCS_ANALYSIS_CONTRACT_REVISION }); return true; }
  if (request.method === "GET" && url.pathname === "/v1/context/analysis-snapshot-v3") { const profileId = url.searchParams.get("profileId"); const authorization = integrationAuthorization(db, request, "read_snapshot", profileId ?? undefined); if (!authorization.ok) { send(response, authorization.status, { error: authorization.error }); return true; } if (!profileId || !analysisSnapshotV3) { send(response, 400, { error: "profile_required" }); return true; } send(response, 200, analysisSnapshotV3(profileId, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("timezone") ?? "UTC")); return true; }
  return false;
}

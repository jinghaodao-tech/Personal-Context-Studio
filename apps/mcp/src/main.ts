import { PcsIntegrationClient, PcsManagementClient } from "../../../packages/integration-sdk/src/index.ts";

const apiUrl = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const integrationClient = process.env.PCS_CLIENT_ID && process.env.PCS_CLIENT_TOKEN
  ? new PcsIntegrationClient({ baseUrl: apiUrl, clientId: process.env.PCS_CLIENT_ID, token: process.env.PCS_CLIENT_TOKEN })
  : undefined;
const managementClient = process.env.PCS_ADMIN_TOKEN
  ? new PcsManagementClient({ baseUrl: apiUrl, adminToken: process.env.PCS_ADMIN_TOKEN })
  : undefined;

const integrationTools = integrationClient ? [{
  name: "list_reviewed_context",
  description: "Read confirmed, purpose-limited context through an explicitly scoped Profile. This MCP server has no write tools.",
  inputSchema: { type: "object", properties: { profileId: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["profileId"], additionalProperties: false },
}] : [];
const managementTools = managementClient ? [
  { name: "search_documents", description: "Search the local Markdown index without modifying source notes.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "get_document_excerpt", description: "Read a bounded excerpt from a source Markdown document.", inputSchema: { type: "object", properties: { documentId: { type: "string" }, maxCharacters: { type: "integer", minimum: 200, maximum: 8000 } }, required: ["documentId"], additionalProperties: false } },
  { name: "list_pending_reviews", description: "List unconfirmed extraction candidates and whether their source is stale.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
] : [];
const tools = [...managementTools, ...integrationTools];

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, any> };
function write(value: unknown) { process.stdout.write(JSON.stringify(value) + "\n"); }
async function callTool(name: string, args: Record<string, any>) {
  if (name === "list_reviewed_context" && integrationClient) {
    if (typeof args.profileId !== "string" || !args.profileId.trim()) throw new Error("profile_id_required");
    return integrationClient.getAnalysisSnapshot(args.profileId, { from: args.from, to: args.to });
  }
  if (name === "search_documents" && managementClient) {
    if (typeof args.query !== "string" || !args.query.trim()) throw new Error("query_required");
    return managementClient.searchDocuments(args.query);
  }
  if (name === "get_document_excerpt" && managementClient) return managementClient.getDocumentExcerpt(String(args.documentId ?? ""), Number(args.maxCharacters ?? 2000));
  if (name === "list_pending_reviews" && managementClient) return managementClient.listPendingReviews();
  throw new Error("tool_not_available");
}
async function handle(request: JsonRpcRequest) {
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") return write({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "personal-context-studio", version: "0.2.0" } } });
  if (request.method === "tools/list") return write({ jsonrpc: "2.0", id: request.id, result: { tools } });
  if (request.method === "tools/call") {
    try { const result = await callTool(String(request.params?.name ?? ""), request.params?.arguments ?? {}); return write({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } }); }
    catch (error) { return write({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } }); }
  }
  if (request.id !== undefined) write({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } });
}
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  const lines = input.split(/\r?\n/);
  input = lines.pop() ?? "";
  for (const line of lines) if (line.trim()) { try { void handle(JSON.parse(line) as JsonRpcRequest); } catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); } }
});

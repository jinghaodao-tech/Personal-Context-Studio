const apiUrl = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, any> };

const tools = [
  { name: "search_documents", description: "Search the local Markdown index without modifying source notes.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "get_document_excerpt", description: "Read a bounded excerpt from a source Markdown document.", inputSchema: { type: "object", properties: { documentId: { type: "string" }, maxCharacters: { type: "integer", minimum: 200, maximum: 8000 } }, required: ["documentId"], additionalProperties: false } },
  { name: "list_reviewed_context", description: "List user-confirmed context through an explicit purpose-limited Profile.", inputSchema: { type: "object", properties: { profileId: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["profileId"], additionalProperties: false } },
  { name: "list_pending_reviews", description: "List unconfirmed extraction candidates and whether their source is stale.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
] as const;

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const value = await response.json();
  if (!response.ok) throw new Error((value as any).error ?? `api_${response.status}`);
  return value;
}

async function callTool(name: string, args: Record<string, any>) {
  if (name === "search_documents") {
    if (typeof args.query !== "string" || !args.query.trim()) throw new Error("query_required");
    return api("/v1/documents/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: args.query }) });
  }
  if (name === "get_document_excerpt") {
    if (typeof args.documentId !== "string") throw new Error("document_id_required");
    const limit = Math.min(8000, Math.max(200, Number(args.maxCharacters ?? 2000)));
    return api(`/v1/documents/${encodeURIComponent(args.documentId)}/excerpt?maxCharacters=${limit}`);
  }
  if (name === "list_reviewed_context") {
    if (typeof args.profileId !== "string" || !args.profileId.trim()) throw new Error("profile_id_required");
    const query = new URLSearchParams({ profileId: args.profileId });
    if (typeof args.from === "string") query.set("from", args.from);
    if (typeof args.to === "string") query.set("to", args.to);
    return api(`/v1/context/analysis-snapshot?${query}`);
  }
  if (name === "list_pending_reviews") return api("/v1/reviews/pending");
  throw new Error("tool_not_found");
}

function write(value: unknown) { process.stdout.write(`${JSON.stringify(value)}\n`); }

async function handle(request: JsonRpcRequest) {
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") return write({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "personal-context-studio", version: "0.1.0" } } });
  if (request.method === "tools/list") return write({ jsonrpc: "2.0", id: request.id, result: { tools } });
  if (request.method === "tools/call") {
    try {
      const result = await callTool(String(request.params?.name ?? ""), request.params?.arguments ?? {});
      return write({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
    } catch (error) {
      return write({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } });
    }
  }
  if (request.id !== undefined) write({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } });
}

process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  const lines = input.split(/\r?\n/);
  input = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try { void handle(JSON.parse(line) as JsonRpcRequest); }
    catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  }
});
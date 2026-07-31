import { localPcsUrl, validateContextAnalysisSnapshot, validateIntegrationImport, validateIntegrationTemplateRequest, type ContextAnalysisSnapshot, type IntegrationImportV1, type IntegrationTemplateRequestV1 } from "../../integration-contracts/src/index.ts";

export type PcsIntegrationClientOptions = {
  baseUrl: string;
  clientId: string;
  token: string;
  fetchImplementation?: typeof fetch;
};

export class PcsIntegrationClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly token: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: PcsIntegrationClientOptions) {
    this.baseUrl = localPcsUrl(options.baseUrl).toString().replace(/\/$/, "");
    if (!options.clientId || !options.token) throw new Error("pcs_integration_credentials_required");
    this.clientId = options.clientId;
    this.token = options.token;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async getAnalysisSnapshot(profileId: string, options: { from?: string; to?: string; timezone?: string } = {}): Promise<ContextAnalysisSnapshot> {
    if (!profileId.trim()) throw new Error("pcs_profile_required");
    const query = new URLSearchParams({ profileId });
    if (options.from) query.set("from", options.from);
    if (options.to) query.set("to", options.to);
    if (options.timezone) query.set("timezone", options.timezone);
    return validateContextAnalysisSnapshot(await this.request(`/v1/context/analysis-snapshot?${query}`));
  }

  async submitTemplateRequest(input: IntegrationTemplateRequestV1) {
    return this.request("/v1/integration-template-requests", { method: "POST", body: JSON.stringify(validateIntegrationTemplateRequest(input)) });
  }

  async submitImport(input: IntegrationImportV1) {
    return this.request("/v1/integration-imports", { method: "POST", body: JSON.stringify(validateIntegrationImport(input)) });
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-pcs-client-id": this.clientId, authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } });
    const payload = await response.json() as unknown;
    if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload ? String((payload as { error: unknown }).error) : `pcs_integration_${response.status}`);
    return payload;
  }
}

export type PcsManagementClientOptions = { baseUrl: string; adminToken?: string; fetchImplementation?: typeof fetch };
export class PcsManagementClient {
  private readonly baseUrl: string;
  private readonly adminToken?: string;
  private readonly fetchImplementation: typeof fetch;
  constructor(options: PcsManagementClientOptions) {
    this.baseUrl = localPcsUrl(options.baseUrl).toString().replace(/\/$/, "");
    this.adminToken = options.adminToken;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }
  async searchDocuments(query: string) { return this.request("/v1/documents/search", { method: "POST", body: JSON.stringify({ query }) }); }
  async getDocumentExcerpt(documentId: string, maxCharacters = 2000) { return this.request("/v1/documents/" + encodeURIComponent(documentId) + "/excerpt?maxCharacters=" + Math.min(8000, Math.max(200, maxCharacters))); }
  async listPendingReviews() { return this.request("/v1/reviews/pending"); }
  private async request(path: string, init: RequestInit = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) };
    if (this.adminToken) headers["x-pcs-admin-token"] = this.adminToken;
    const response = await this.fetchImplementation(this.baseUrl + path, { ...init, headers });
    const payload = await response.json() as unknown;
    if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload ? String((payload as { error: unknown }).error) : "pcs_management_request_failed");
    return payload;
  }
}

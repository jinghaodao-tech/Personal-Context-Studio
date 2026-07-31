import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";

export const integrationPermissions = ["read_snapshot", "submit_template_request", "submit_import"] as const;
export type IntegrationPermission = typeof integrationPermissions[number];

export function hashIntegrationToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function managementAuthorized(request: IncomingMessage, configuredToken: string | undefined, db?: DatabaseSync) {
  if (!configuredToken) return true;
  const supplied = typeof request.headers["x-pcs-admin-token"] === "string" ? request.headers["x-pcs-admin-token"] : "";
  const expected = Buffer.from(configuredToken);
  const actual = Buffer.from(supplied);
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  const session = typeof request.headers["x-pcs-session-token"] === "string" ? request.headers["x-pcs-session-token"].trim() : "";
  if (!session || !db) return false;
  return Boolean(db.prepare("SELECT 1 FROM auth_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? ").get(hashIntegrationToken(session), new Date().toISOString()));
}

export function isIntegrationRequest(method: string | undefined, pathname: string) {
  return (method === "GET" && pathname === "/v1/context/analysis-snapshot")
    || (method === "POST" && pathname === "/v1/integration-template-requests")
    || (method === "POST" && pathname === "/v1/integration-imports");
}

export function integrationAuthorized(db: DatabaseSync, request: IncomingMessage, permission: IntegrationPermission) {
  return integrationAuthorization(db, request, permission).ok;
}

export function integrationAuthorization(db: DatabaseSync, request: IncomingMessage, permission: IntegrationPermission, profileId?: string) {
  const clientId = typeof request.headers["x-pcs-client-id"] === "string" ? request.headers["x-pcs-client-id"].trim() : "";
  const authorization = typeof request.headers.authorization === "string" ? request.headers.authorization.trim() : "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!clientId || !token) return { ok: false, status: 401, error: "integration_authorization_required" };
  const client = db.prepare("SELECT permissions_json FROM integration_clients WHERE id=? AND token_hash=? AND is_active=1").get(clientId, hashIntegrationToken(token)) as { permissions_json: string } | undefined;
  if (!client) return { ok: false, status: 401, error: "integration_authorization_required" };
  try {
    if (!(JSON.parse(client.permissions_json) as unknown[]).includes(permission)) return { ok: false, status: 403, error: "integration_permission_forbidden" };
  } catch {
    return { ok: false, status: 401, error: "integration_authorization_required" };
  }
  if (profileId) {
    const scoped = db.prepare("SELECT 1 FROM integration_client_profiles WHERE client_id=? AND profile_id=?").get(clientId, profileId);
    const hasAnyScope = db.prepare("SELECT 1 FROM integration_client_profiles WHERE client_id=? LIMIT 1").get(clientId);
    if (!scoped) return { ok: false, status: 403, error: hasAnyScope ? "integration_profile_forbidden" : "integration_profile_scope_required" };
  }
  return { ok: true, status: 200, error: "" };
}

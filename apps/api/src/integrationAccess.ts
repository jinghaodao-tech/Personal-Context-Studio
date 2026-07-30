import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";

export const integrationPermissions = ["read_snapshot", "submit_template_request", "submit_import"] as const;
export type IntegrationPermission = typeof integrationPermissions[number];

export function hashIntegrationToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function integrationAuthorized(db: DatabaseSync, request: IncomingMessage, permission: IntegrationPermission) {
  const clientId = typeof request.headers["x-pcs-client-id"] === "string" ? request.headers["x-pcs-client-id"].trim() : "";
  const authorization = typeof request.headers.authorization === "string" ? request.headers.authorization.trim() : "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!clientId || !token) return false;
  const client = db.prepare("SELECT permissions_json FROM integration_clients WHERE id=? AND token_hash=? AND is_active=1").get(clientId, hashIntegrationToken(token)) as { permissions_json: string } | undefined;
  if (!client) return false;
  try {
    return (JSON.parse(client.permissions_json) as unknown[]).includes(permission);
  } catch {
    return false;
  }
}

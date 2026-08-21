// Checker 3 of 5 (ADR-022): Authentication / Permission Checker. Deliberately
// does NOT add a privileged "diagnostics" endpoint to PCS. Instead it calls
// the real endpoint each required/optional permission already maps to, using
// the connector's own credentials, and classifies the response the same way
// apps/api/src/integrationAccess.ts's `integrationAuthorization` produces it:
//
//   401 integration_authorization_required -> credentials invalid
//   403 integration_permission_forbidden   -> authenticated, permission missing
//   403 integration_profile_forbidden /
//       integration_profile_scope_required -> permission OK, profile not scoped
//   200                                    -> permission genuinely usable
//
// Only `read_snapshot` has a safe (GET, non-mutating) endpoint to probe this
// way today. `submit_template_request`, `submit_import`, and
// `append_markdown_template` are all writes; probing them for real would
// create real data, which v0.1 has no dry-run path to avoid (see ADR-022
// Sequencing -- dry-run probing is v0.2+). For those, this checker reports
// an explicit "not probed" INFO result rather than silently skipping them or
// pretending to have verified something it didn't.
//
// credentials.profileId is deliberately not part of the Connector Manifest:
// a manifest describes what a connector *needs* (shape), not the specific
// instance credentials/profile it happens to run with today -- MeTheory
// itself keeps clientId/token/profileId in env vars, not in a manifest, and
// this checker follows that same split.

import type { CheckResult, ConnectorManifest, IntegrationPermission } from "../types.ts";

export type AuthProbeCredentials = { clientId: string; token: string; profileId?: string };
export type AuthPermissionCheckOptions = { fetchImplementation?: typeof fetch; timeoutMs?: number };

const readOnlyPermissionEndpoint: Partial<Record<IntegrationPermission, (baseUrl: string, profileId?: string) => string>> = {
  read_snapshot: (baseUrl, profileId) => `${baseUrl.replace(/\/$/, "")}/v1/context/analysis-snapshot-v3${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`,
};

export async function checkAuthenticationAndPermissions(manifest: ConnectorManifest, credentials: AuthProbeCredentials, options: AuthPermissionCheckOptions = {}): Promise<CheckResult[]> {
  if (!credentials.clientId || !credentials.token) {
    return [{ checkId: "auth.credentials", status: "FATAL", code: "PCS-DOC-2101", message: "No clientId/token supplied to the Doctor -- authentication cannot be probed without real credentials." }];
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const declared = [...new Set([...manifest.permissions.required, ...manifest.permissions.optional])];
  const results: CheckResult[] = [];

  for (const permission of declared) {
    const isRequired = manifest.permissions.required.includes(permission);
    const buildUrl = readOnlyPermissionEndpoint[permission];
    if (!buildUrl) {
      results.push({ checkId: `permission.${permission}`, status: "INFO", code: "PCS-DOC-4004", message: `"${permission}" is a write permission; v0.1 has no dry-run path to probe it without creating real data. Not verified -- see ADR-022 Sequencing.` });
      continue;
    }

    const url = buildUrl(manifest.transport.baseUrl, credentials.profileId);
    let response: Response;
    try {
      response = await fetchImplementation(url, { headers: { "x-pcs-client-id": credentials.clientId, authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      results.push({ checkId: `permission.${permission}`, status: isRequired ? "FATAL" : "ERROR", code: "PCS-DOC-2001", message: `Probing "${permission}" at ${url} failed at the network level: ${String(error)}.` });
      continue;
    }

    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 401 || payload.error === "integration_authorization_required") {
      results.push({ checkId: `permission.${permission}`, status: "FATAL", code: "PCS-DOC-2101", message: `Credentials rejected (401 ${payload.error ?? ""}) while probing "${permission}". clientId/token do not match an active PCS integration client.` });
      // Credentials are wrong for every permission, not just this one --
      // no point repeating the same failure for the rest of the list.
      break;
    }
    if (payload.error === "integration_permission_forbidden") {
      results.push({ checkId: `permission.${permission}`, status: isRequired ? "ERROR" : "WARNING", code: "PCS-DOC-4001", message: `PCS reports the client does not have "${permission}" (integration_permission_forbidden).${isRequired ? " This permission is required by the manifest." : ""}` });
      continue;
    }
    if (payload.error === "integration_profile_forbidden" || payload.error === "integration_profile_scope_required") {
      results.push({ checkId: `permission.${permission}`, status: isRequired ? "ERROR" : "WARNING", code: "PCS-DOC-4002", message: `"${permission}" is granted, but the client is not scoped to the requested Context Profile (${payload.error}).${credentials.profileId ? "" : " No profileId was supplied to this probe, so this may just mean the client has no profile scope at all."}` });
      continue;
    }
    if (response.status === 400 && payload.error === "profile_required") {
      results.push({ checkId: `permission.${permission}`, status: "INFO", code: "PCS-DOC-4003", message: `"${permission}" is authorized (token and permission are valid); the probe itself omitted profileId, so PCS returned 400 profile_required before returning data. Supply credentials.profileId to fully verify profile scope.` });
      continue;
    }
    if (response.ok) {
      results.push({ checkId: `permission.${permission}`, status: "PASS", code: "PCS-DOC-4003", message: `"${permission}" is authorized and returned data successfully.` });
      continue;
    }
    results.push({ checkId: `permission.${permission}`, status: "ERROR", code: "PCS-DOC-4001", message: `Unexpected response probing "${permission}": HTTP ${response.status} ${payload.error ?? "(no error field)"}.` });
  }

  return results;
}

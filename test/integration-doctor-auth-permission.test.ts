import test from "node:test";
import assert from "node:assert/strict";
import { checkAuthenticationAndPermissions } from "../packages/integration-doctor/src/checks/authPermission.ts";
import type { ConnectorManifest } from "../packages/integration-doctor/src/types.ts";

const METHEORY_MANIFEST: ConnectorManifest = {
  manifestVersion: "pcs-connector-manifest-v1",
  connectorId: "metheory",
  displayName: "MeTheory",
  sourceSystem: "metheory",
  pcsContract: { minimumRevision: "pcs-analysis-snapshot-v2.1", maximumRevision: "pcs-analysis-snapshot-v3.x" },
  transport: { protocol: "http", baseUrl: "http://127.0.0.1:8300", localhostOnly: true },
  auth: { mode: "integration-client", headers: ["x-pcs-client-id", "authorization"], profileScoped: true },
  permissions: { required: ["read_snapshot", "submit_template_request"], optional: [] },
  capabilities: { readSnapshot: true, submitImport: false, submitTemplateRequest: true },
  endpoints: { readSnapshot: "GET /v1/context/analysis-snapshot-v3", submitTemplateRequest: "POST /v1/integration-template-requests" },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

test("Authentication/Permission Checker: no credentials -> single FATAL, no network call attempted", async () => {
  const fetchImplementation = (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(METHEORY_MANIFEST, { clientId: "", token: "" }, { fetchImplementation });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "FATAL");
  assert.equal(results[0].code, "PCS-DOC-2101");
});

test("Authentication/Permission Checker: read_snapshot succeeds -> PASS, write permission reported as not-probed INFO", async () => {
  const fetchImplementation = (async () => jsonResponse(200, { schemaVersion: "pcs-analysis-snapshot-v3" })) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(METHEORY_MANIFEST, { clientId: "client_1", token: "tok", profileId: "profile_1" }, { fetchImplementation });
  const readResult = results.find((result) => result.checkId === "permission.read_snapshot");
  const writeResult = results.find((result) => result.checkId === "permission.submit_template_request");
  assert.equal(readResult?.status, "PASS");
  assert.equal(readResult?.code, "PCS-DOC-4003");
  assert.equal(writeResult?.status, "INFO");
  assert.equal(writeResult?.code, "PCS-DOC-4004");
});

test("Authentication/Permission Checker: 401 is FATAL and stops probing remaining permissions", async () => {
  const fetchImplementation = (async () => jsonResponse(401, { error: "integration_authorization_required" })) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(METHEORY_MANIFEST, { clientId: "client_1", token: "bad-token", profileId: "profile_1" }, { fetchImplementation });
  assert.equal(results.length, 1, "should stop after the first 401 instead of repeating the same failure per permission");
  assert.equal(results[0].status, "FATAL");
  assert.equal(results[0].code, "PCS-DOC-2101");
});

test("Authentication/Permission Checker: integration_permission_forbidden on a required permission is ERROR", async () => {
  const fetchImplementation = (async () => jsonResponse(403, { error: "integration_permission_forbidden" })) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(METHEORY_MANIFEST, { clientId: "client_1", token: "tok", profileId: "profile_1" }, { fetchImplementation });
  const readResult = results.find((result) => result.checkId === "permission.read_snapshot");
  assert.equal(readResult?.status, "ERROR");
  assert.equal(readResult?.code, "PCS-DOC-4001");
});

test("Authentication/Permission Checker: integration_permission_forbidden on an optional permission is WARNING, not ERROR", async () => {
  const manifest: ConnectorManifest = { ...METHEORY_MANIFEST, permissions: { required: ["submit_template_request"], optional: ["read_snapshot"] } };
  const fetchImplementation = (async () => jsonResponse(403, { error: "integration_permission_forbidden" })) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(manifest, { clientId: "client_1", token: "tok", profileId: "profile_1" }, { fetchImplementation });
  const readResult = results.find((result) => result.checkId === "permission.read_snapshot");
  assert.equal(readResult?.status, "WARNING");
});

test("Authentication/Permission Checker: profile scope error is distinguished from permission error", async () => {
  const fetchImplementation = (async () => jsonResponse(403, { error: "integration_profile_forbidden" })) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(METHEORY_MANIFEST, { clientId: "client_1", token: "tok", profileId: "profile_not_allowed" }, { fetchImplementation });
  const readResult = results.find((result) => result.checkId === "permission.read_snapshot");
  assert.equal(readResult?.status, "ERROR");
  assert.equal(readResult?.code, "PCS-DOC-4002");
});

test("Authentication/Permission Checker: omitting profileId surfaces 400 profile_required as INFO, not a failure", async () => {
  const fetchImplementation = (async () => jsonResponse(400, { error: "profile_required" })) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(METHEORY_MANIFEST, { clientId: "client_1", token: "tok" }, { fetchImplementation });
  const readResult = results.find((result) => result.checkId === "permission.read_snapshot");
  assert.equal(readResult?.status, "INFO");
  assert.equal(readResult?.code, "PCS-DOC-4003");
});

test("Authentication/Permission Checker: a network-level failure on a required permission is FATAL", async () => {
  const fetchImplementation = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const results = await checkAuthenticationAndPermissions(METHEORY_MANIFEST, { clientId: "client_1", token: "tok", profileId: "profile_1" }, { fetchImplementation });
  const readResult = results.find((result) => result.checkId === "permission.read_snapshot");
  assert.equal(readResult?.status, "FATAL");
  assert.equal(readResult?.code, "PCS-DOC-2001");
});

import test from "node:test";
import assert from "node:assert/strict";
import { checkManifest, manifestChecksPassed } from "../packages/integration-doctor/src/checks/manifest.ts";
import { checkTransport } from "../packages/integration-doctor/src/checks/transport.ts";
import { buildReport, formatReportText } from "../packages/integration-doctor/src/report.ts";
import type { ConnectorManifest } from "../packages/integration-doctor/src/types.ts";

// Mirrors MeTheory's real, already-deployed manifest at
// MeTheory/docs/metheory-pcs-connector.manifest.json. Copied rather than
// read cross-repo because PCS's own CI (`npm run verify:ci`) checks out
// only this repo -- a test that requires a sibling MeTheory checkout on
// disk would pass locally and fail in CI. If MeTheory's manifest changes,
// this fixture needs updating by hand; that drift is itself something
// checker 1 exists to catch once the Doctor is wired into MeTheory's own
// CI (see ADR-022 Sequencing).
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
  notes: "MeTheory does not submit PCS imports. User confirmation remains required in PCS before values enter an analysis snapshot.",
};

test("Static Manifest Checker: MeTheory's real manifest passes with no errors", () => {
  const results = checkManifest(METHEORY_MANIFEST);
  const problems = results.filter((result) => result.status === "ERROR" || result.status === "FATAL");
  assert.deepEqual(problems, [], `expected no ERROR/FATAL, got: ${JSON.stringify(problems, null, 2)}`);
  assert.ok(manifestChecksPassed(results));
  assert.ok(results.length > 5, "expected multiple sub-checks to have run, not a single pass/fail");
});

test("Static Manifest Checker: rejects an unrecognized manifestVersion", () => {
  const results = checkManifest({ ...METHEORY_MANIFEST, manifestVersion: "pcs-connector-manifest-v2" });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "FATAL");
  assert.equal(results[0].code, "PCS-DOC-1002");
});

test("Static Manifest Checker: flags an unknown permission", () => {
  const results = checkManifest({ ...METHEORY_MANIFEST, permissions: { required: ["read_snapshot", "delete_everything"], optional: [] } });
  const unknown = results.find((result) => result.code === "PCS-DOC-1003");
  assert.ok(unknown, "expected a PCS-DOC-1003 result");
  assert.equal(unknown!.status, "ERROR");
  assert.match(unknown!.message, /delete_everything/);
});

test("Static Manifest Checker: flags a duplicate permission across required/optional", () => {
  const results = checkManifest({ ...METHEORY_MANIFEST, permissions: { required: ["read_snapshot"], optional: ["read_snapshot"] } });
  const duplicate = results.find((result) => result.code === "PCS-DOC-1004");
  assert.ok(duplicate, "expected a PCS-DOC-1004 result");
  assert.equal(duplicate!.status, "ERROR");
});

test("Static Manifest Checker: flags capabilities/permissions contradiction (this is the exact example from ADR-022)", () => {
  const results = checkManifest({ ...METHEORY_MANIFEST, capabilities: { readSnapshot: true, submitImport: true, submitTemplateRequest: true }, permissions: { required: ["read_snapshot"], optional: [] } });
  const contradiction = results.find((result) => result.code === "PCS-DOC-1007" && result.status === "ERROR");
  assert.ok(contradiction, "expected a PCS-DOC-1007 ERROR result");
  assert.match(contradiction!.message, /submitImport=true/);
});

test("Static Manifest Checker: warns (does not error) when a required permission has no matching capability", () => {
  const results = checkManifest({ ...METHEORY_MANIFEST, permissions: { required: ["read_snapshot", "submit_template_request", "submit_import"], optional: [] }, capabilities: { readSnapshot: true, submitImport: false, submitTemplateRequest: true } });
  const softMismatch = results.find((result) => result.checkId === "manifest.capabilities.softMismatch");
  assert.ok(softMismatch, "expected a soft-mismatch WARNING");
  assert.equal(softMismatch!.status, "WARNING");
  const hardError = results.find((result) => result.checkId === "manifest.capabilities.contradiction" && result.status === "ERROR");
  assert.equal(hardError, undefined, "a required-but-uncapable permission should warn, not error");
});

test("Transport Checker: MeTheory's real baseUrl passes the loopback check without a network call", async () => {
  const results = await checkTransport(METHEORY_MANIFEST, { probeReachability: false });
  const problems = results.filter((result) => result.status === "ERROR" || result.status === "FATAL");
  assert.deepEqual(problems, []);
  assert.ok(results.some((result) => result.checkId === "transport.localhost" && result.status === "PASS"));
});

test("Transport Checker: rejects a non-loopback baseUrl", async () => {
  const manifest = { ...METHEORY_MANIFEST, transport: { ...METHEORY_MANIFEST.transport, baseUrl: "http://example.com:8300" } };
  const results = await checkTransport(manifest, { probeReachability: false });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "FATAL");
  assert.equal(results[0].code, "PCS-DOC-2002");
});

test("Transport Checker: rejects an unparseable baseUrl", async () => {
  const manifest = { ...METHEORY_MANIFEST, transport: { ...METHEORY_MANIFEST.transport, baseUrl: "not a url" } };
  const results = await checkTransport(manifest, { probeReachability: false });
  assert.equal(results[0].status, "FATAL");
  assert.equal(results[0].code, "PCS-DOC-2003");
});

test("Transport Checker: reachability probe passes on any HTTP response, including 404", async () => {
  const fakeFetch = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
  const results = await checkTransport(METHEORY_MANIFEST, { fetchImplementation: fakeFetch });
  const reachable = results.find((result) => result.checkId === "transport.reachable");
  assert.equal(reachable?.status, "PASS");
});

test("Transport Checker: reachability probe fails FATAL on a connection error", async () => {
  const fakeFetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const results = await checkTransport(METHEORY_MANIFEST, { fetchImplementation: fakeFetch });
  const reachable = results.find((result) => result.checkId === "transport.reachable");
  assert.equal(reachable?.status, "FATAL");
  assert.equal(reachable?.code, "PCS-DOC-2001");
});

test("buildReport / formatReportText: MeTheory's real manifest reports overall PASS", async () => {
  const manifestResults = checkManifest(METHEORY_MANIFEST);
  const transportResults = await checkTransport(METHEORY_MANIFEST, { probeReachability: false });
  const report = buildReport("metheory", [...manifestResults, ...transportResults]);
  assert.equal(report.status, "PASS");
  const text = formatReportText(report);
  assert.match(text, /Connector: metheory/);
  assert.match(text, /Connector status: PASS/);
});

test("buildReport: a manifest with a FATAL check reports INCOMPATIBLE, not just DEGRADED", async () => {
  const manifestResults = checkManifest({ ...METHEORY_MANIFEST, manifestVersion: "pcs-connector-manifest-v2" });
  const report = buildReport("metheory", manifestResults);
  assert.equal(report.status, "INCOMPATIBLE");
});

test("buildReport: a manifest with only a WARNING (soft mismatch) reports DEGRADED, not PASS", async () => {
  const manifestResults = checkManifest({ ...METHEORY_MANIFEST, permissions: { required: ["read_snapshot", "submit_template_request", "submit_import"], optional: [] }, capabilities: { readSnapshot: true, submitImport: false, submitTemplateRequest: true } });
  const problems = manifestResults.filter((result) => result.status === "ERROR" || result.status === "FATAL");
  assert.deepEqual(problems, [], "this fixture should produce a WARNING only, not an ERROR -- otherwise the test isn't isolating what it claims to");
  const report = buildReport("metheory", manifestResults);
  assert.equal(report.status, "DEGRADED");
});

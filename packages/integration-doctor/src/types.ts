// Types for ADR-022's Integration Doctor. See
// docs/adr/PCS/ADR-022-integration-doctor.md for the design and the reasons
// behind the detect/diagnose/explain-only boundary (no repair, no mutation).

// Permission vocabulary is owned by apps/api/src/integrationAccess.ts
// (`integrationPermissions`), not by this package -- packages/ does not
// import from apps/ anywhere else in this repo, and this file keeps that
// direction. This list is kept in sync manually with that source of truth;
// the Static Manifest Checker's own test suite is what would catch drift
// (a manifest using a permission this list doesn't know about is exactly
// the kind of thing PCS-DOC-1003 exists to report).
export const KNOWN_INTEGRATION_PERMISSIONS = ["read_snapshot", "submit_template_request", "submit_import", "append_markdown_template"] as const;
export type IntegrationPermission = (typeof KNOWN_INTEGRATION_PERMISSIONS)[number];

export const CONNECTOR_MANIFEST_VERSION = "pcs-connector-manifest-v1" as const;

// Matches docs/metheory-pcs-connector.manifest.json, the first real manifest
// written against this type (MeTheory's already-deployed integration -- see
// ADR-022's corrected Context section). The schema is deliberately richer
// than ADR-022's illustrative StudyGraph example: transport/auth/endpoints
// were added because a real manifest needed them to be checkable.
export type ConnectorManifest = {
  manifestVersion: typeof CONNECTOR_MANIFEST_VERSION;
  connectorId: string;
  displayName: string;
  sourceSystem: string;
  // Optional because not every connector has a versioned, revisioned
  // contract to range-check against: the analysis-snapshot flow does
  // (PCS_ANALYSIS_CONTRACT_REVISION), but IntegrationImportV1 (the
  // submit_import contract) has no schemaVersion/contractRevision field at
  // all -- see ADR-022 Sequencing's "Before v0.2" entry and dev-pace's real
  // manifest. A connector that declares capabilities.readSnapshot: true is
  // still expected to provide one; checkManifest enforces that
  // conditionally rather than this type enforcing it unconditionally.
  pcsContract?: { minimumRevision: string; maximumRevision: string };
  transport: { protocol: "http"; baseUrl: string; localhostOnly: boolean };
  auth: { mode: string; headers: string[]; profileScoped: boolean };
  permissions: { required: IntegrationPermission[]; optional: IntegrationPermission[] };
  capabilities: { readSnapshot: boolean; submitImport: boolean; submitTemplateRequest: boolean };
  endpoints: Partial<Record<"readSnapshot" | "submitImport" | "submitTemplateRequest", string>>;
  notes?: string;
};

// Fixed severity scale (ADR-022 "Diagnostic Result").
export type Severity = "PASS" | "INFO" | "WARNING" | "ERROR" | "FATAL";

// Fixed error-code ranges (ADR-022): 1xxx Manifest, 2xxx Transport/Auth,
// 3xxx Contract, 4xxx Permission, 5xxx Semantic, 6xxx PCS Runtime,
// 7xxx Connector Runtime. Codes are added to this table as checkers are
// implemented; a checker must not invent a code outside its assigned range.
export type DiagnosticCode =
  | "PCS-DOC-1001" // invalid_manifest: manifest fails basic shape validation
  | "PCS-DOC-1002" // unsupported_manifest_version
  | "PCS-DOC-1003" // unknown_permission: permission not in integrationPermissions
  | "PCS-DOC-1004" // duplicate_permission
  | "PCS-DOC-1005" // invalid_connector_id or invalid_source_system (validSourceSystem pattern)
  | "PCS-DOC-1006" // invalid_contract_range: minimumRevision > maximumRevision lexically implausible, or missing
  | "PCS-DOC-1007" // manifest_contradiction: capability true but required permission not declared (or vice versa)
  | "PCS-DOC-2001" // pcs_unreachable
  | "PCS-DOC-2002" // non_local_endpoint
  | "PCS-DOC-2003" // malformed_endpoint: transport.baseUrl is not a parseable URL
  | "PCS-DOC-2101" // invalid_credentials
  | "PCS-DOC-4001" // required_permission_missing: probe returned integration_permission_forbidden
  | "PCS-DOC-4002" // profile_scope_missing: probe returned integration_profile_forbidden / integration_profile_scope_required
  | "PCS-DOC-4003" // permission_verified: probe succeeded (used as the code on PASS results, mirrors 4001's range)
  | "PCS-DOC-4004" // permission_not_probed: write permission, no dry-run in v0.1 (INFO, not a failure)
  | "PCS-DOC-3001" // contract_version_unsupported: response contractRevision falls outside manifest.pcsContract's declared range
  | "PCS-DOC-3002" // snapshot_schema_invalid: an integration-contracts validator threw on the response payload
  | "PCS-DOC-3003" // contract_version_unparseable: a revision string doesn't match the "prefix-vMAJOR.MINOR" convention
  ;

export type CheckResult = {
  checkId: string;
  status: Severity;
  code: DiagnosticCode;
  message: string;
  location?: string;
  detail?: Record<string, unknown>;
};

export type DiagnosticReport = {
  connectorId: string;
  checks: CheckResult[];
  status: "PASS" | "DEGRADED" | "INCOMPATIBLE";
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

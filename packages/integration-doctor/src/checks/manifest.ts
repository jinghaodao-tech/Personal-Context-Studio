// Checker 1 of 5 (ADR-022): Static Manifest Checker. No network call --
// everything here can run against a manifest file alone. Unlike the request
// validators in integration-contracts, this checker does not throw on the
// first problem: a diagnostic tool's job is to report everything wrong at
// once, not stop at the first error.

import { CONNECTOR_MANIFEST_VERSION, KNOWN_INTEGRATION_PERMISSIONS, isRecord, type CheckResult, type IntegrationPermission } from "../types.ts";

const sourceSystemPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const capabilityToPermission: Record<"readSnapshot" | "submitImport" | "submitTemplateRequest", IntegrationPermission> = {
  readSnapshot: "read_snapshot",
  submitImport: "submit_import",
  submitTemplateRequest: "submit_template_request",
};

function pass(checkId: string, message: string): CheckResult {
  return { checkId, status: "PASS", code: "PCS-DOC-1001", message };
}

/**
 * Runs the Static Manifest Checker against an unknown value (typically a
 * parsed manifest JSON file). Always returns at least one result. Does not
 * throw -- an unparseable/wrong-shape manifest is reported as a FATAL
 * CheckResult, not an exception, so callers can always render a report.
 */
export function checkManifest(value: unknown): CheckResult[] {
  if (!isRecord(value)) {
    return [{ checkId: "manifest.shape", status: "FATAL", code: "PCS-DOC-1001", message: "Manifest is not a JSON object.", location: "$" }];
  }

  const results: CheckResult[] = [];

  // -- manifestVersion --
  if (value.manifestVersion !== CONNECTOR_MANIFEST_VERSION) {
    results.push({ checkId: "manifest.version", status: "FATAL", code: "PCS-DOC-1002", message: `Unsupported manifestVersion: expected "${CONNECTOR_MANIFEST_VERSION}", got ${JSON.stringify(value.manifestVersion)}.`, location: "$.manifestVersion" });
    // Nothing below this line can be trusted to mean what it claims to mean
    // once the manifest format itself is unrecognized, so stop here.
    return results;
  }
  results.push(pass("manifest.version", "manifestVersion is recognized."));

  // -- connectorId / sourceSystem --
  for (const field of ["connectorId", "sourceSystem"] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue !== "string" || !sourceSystemPattern.test(fieldValue)) {
      results.push({ checkId: `manifest.${field}`, status: "ERROR", code: "PCS-DOC-1005", message: `${field} must match ${sourceSystemPattern.source} (lowercase, starts with a letter, <=64 chars). Got ${JSON.stringify(fieldValue)}.`, location: `$.${field}` });
    } else {
      results.push(pass(`manifest.${field}`, `${field} is well-formed.`));
    }
  }

  if (typeof value.displayName !== "string" || !value.displayName.trim()) {
    results.push({ checkId: "manifest.displayName", status: "ERROR", code: "PCS-DOC-1001", message: "displayName must be a non-empty string.", location: "$.displayName" });
  } else {
    results.push(pass("manifest.displayName", "displayName is present."));
  }

  // -- pcsContract --
  // Optional overall: not every connector has a versioned/revisioned
  // contract to range-check (submit_import's IntegrationImportV1 has no
  // contractRevision field, unlike the analysis-snapshot flow -- see
  // ADR-022 Sequencing's "Before v0.2" entry). Only connectors that claim
  // capabilities.readSnapshot are required to declare one, since that's
  // the only capability checker 4's range logic actually applies to today.
  const pcsContract = value.pcsContract;
  const capabilitiesForContractCheck = value.capabilities;
  const claimsReadSnapshotForContractCheck = isRecord(capabilitiesForContractCheck) && capabilitiesForContractCheck.readSnapshot === true;
  if (pcsContract === undefined) {
    if (claimsReadSnapshotForContractCheck) {
      results.push({ checkId: "manifest.pcsContract", status: "ERROR", code: "PCS-DOC-1006", message: "pcsContract is required when capabilities.readSnapshot is true (the Contract Checker's revision-range check needs it).", location: "$.pcsContract" });
    } else {
      results.push(pass("manifest.pcsContract", "pcsContract omitted; connector does not claim capabilities.readSnapshot, so no revision range is required."));
    }
  } else if (!isRecord(pcsContract) || typeof pcsContract.minimumRevision !== "string" || !pcsContract.minimumRevision.trim() || typeof pcsContract.maximumRevision !== "string" || !pcsContract.maximumRevision.trim()) {
    results.push({ checkId: "manifest.pcsContract", status: "ERROR", code: "PCS-DOC-1006", message: "pcsContract, if present, must have non-empty pcsContract.minimumRevision and pcsContract.maximumRevision strings.", location: "$.pcsContract" });
  } else {
    results.push(pass("manifest.pcsContract", "pcsContract declares a revision range."));
  }

  // -- permissions: unknown / duplicate --
  const permissions = value.permissions;
  let required: string[] = [];
  let optional: string[] = [];
  if (!isRecord(permissions) || !Array.isArray(permissions.required) || !Array.isArray(permissions.optional)) {
    results.push({ checkId: "manifest.permissions.shape", status: "ERROR", code: "PCS-DOC-1001", message: "permissions.required and permissions.optional must both be arrays.", location: "$.permissions" });
  } else {
    required = permissions.required;
    optional = permissions.optional;
    const unknown = [...required, ...optional].filter((permission) => !KNOWN_INTEGRATION_PERMISSIONS.includes(permission as IntegrationPermission));
    if (unknown.length > 0) {
      results.push({ checkId: "manifest.permissions.unknown", status: "ERROR", code: "PCS-DOC-1003", message: `Unknown permission(s) not in PCS's integration permission vocabulary: ${unknown.map((item) => JSON.stringify(item)).join(", ")}.`, location: "$.permissions", detail: { unknown, known: KNOWN_INTEGRATION_PERMISSIONS } });
    } else {
      results.push(pass("manifest.permissions.unknown", "All declared permissions are recognized."));
    }
    const overlap = required.filter((permission) => optional.includes(permission));
    const dupWithinRequired = required.filter((permission, index) => required.indexOf(permission) !== index);
    const dupWithinOptional = optional.filter((permission, index) => optional.indexOf(permission) !== index);
    const duplicates = [...new Set([...overlap, ...dupWithinRequired, ...dupWithinOptional])];
    if (duplicates.length > 0) {
      results.push({ checkId: "manifest.permissions.duplicate", status: "ERROR", code: "PCS-DOC-1004", message: `Permission(s) listed more than once, or in both required and optional: ${duplicates.map((item) => JSON.stringify(item)).join(", ")}.`, location: "$.permissions", detail: { duplicates } });
    } else {
      results.push(pass("manifest.permissions.duplicate", "No duplicate permission declarations."));
    }
  }

  // -- capabilities vs permissions contradiction --
  const capabilities = value.capabilities;
  if (!isRecord(capabilities) || (["readSnapshot", "submitImport", "submitTemplateRequest"] as const).some((key) => typeof capabilities[key] !== "boolean")) {
    results.push({ checkId: "manifest.capabilities.shape", status: "ERROR", code: "PCS-DOC-1001", message: "capabilities.readSnapshot, .submitImport, and .submitTemplateRequest must all be booleans.", location: "$.capabilities" });
  } else {
    const declared = new Set([...required, ...optional]);
    const contradictions: string[] = [];
    const softMismatches: string[] = [];
    for (const [capabilityKey, permission] of Object.entries(capabilityToPermission) as Array<[keyof typeof capabilityToPermission, IntegrationPermission]>) {
      const claimsCapability = capabilities[capabilityKey] === true;
      const declaresPermission = declared.has(permission);
      if (claimsCapability && !declaresPermission) contradictions.push(`capabilities.${capabilityKey}=true but permissions does not declare "${permission}"`);
      if (!claimsCapability && required.includes(permission)) softMismatches.push(`permissions.required includes "${permission}" but capabilities.${capabilityKey}=false`);
    }
    if (contradictions.length > 0) {
      results.push({ checkId: "manifest.capabilities.contradiction", status: "ERROR", code: "PCS-DOC-1007", message: `Manifest contradiction(s): ${contradictions.join("; ")}.`, location: "$.capabilities", detail: { contradictions } });
    } else {
      results.push(pass("manifest.capabilities.contradiction", "Capabilities and declared permissions are mutually consistent."));
    }
    if (softMismatches.length > 0) {
      results.push({ checkId: "manifest.capabilities.softMismatch", status: "WARNING", code: "PCS-DOC-1007", message: `Required permission not reflected in capabilities (may be intentional, e.g. reserved for future use): ${softMismatches.join("; ")}.`, location: "$.capabilities", detail: { softMismatches } });
    }
  }

  return results;
}

export function manifestChecksPassed(results: CheckResult[]): boolean {
  return results.every((result) => result.status !== "ERROR" && result.status !== "FATAL");
}

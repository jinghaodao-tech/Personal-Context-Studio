// Checker 4 of 5 (ADR-022): Contract Checker. Does not reimplement PCS's
// schema rules -- wraps `validateContextAnalysisSnapshot` from
// integration-contracts, the same validator the API server and every real
// client already depend on. The validator's job stays "throw on the first
// problem"; this checker's only job is turning that throw into a structured
// CheckResult instead of an uncaught exception, plus checking the response's
// contractRevision against what the manifest says it can handle.

// See the equivalent comment in checks/transport.ts: imports the compiled
// dist because this package is consumed externally as a pinned git
// dependency, and only dist is published.
import { validateContextAnalysisSnapshot, validateIntegrationImport } from "../../../integration-contracts/dist/index.js";
import { isRecord, type CheckResult, type ConnectorManifest } from "../types.ts";

type ParsedRevision = { prefix: string; major: number; minor: number | "x" };

// Matches PCS's actual revision strings: "pcs-analysis-snapshot-v2.1",
// "pcs-analysis-snapshot-v3.0", and manifest-side wildcards like
// "pcs-analysis-snapshot-v3.x". V1 snapshots ("pcs-context-analysis-snapshot-v1",
// no dot, no contractRevision field at all) don't match this and are
// handled as a separate, simpler case below.
function parseRevision(revision: string): ParsedRevision | null {
  const match = /^(.*)-v(\d+)\.(\d+|x)$/.exec(revision);
  if (!match) return null;
  return { prefix: match[1], major: Number(match[2]), minor: match[3] === "x" ? "x" : Number(match[3]) };
}

function atLeast(actual: ParsedRevision, minimum: ParsedRevision): boolean {
  if (actual.major !== minimum.major) return actual.major > minimum.major;
  if (minimum.minor === "x") return true;
  return (actual.minor === "x" ? 0 : actual.minor) >= minimum.minor;
}

function atMost(actual: ParsedRevision, maximum: ParsedRevision): boolean {
  if (actual.major !== maximum.major) return actual.major < maximum.major;
  if (maximum.minor === "x") return true;
  return (actual.minor === "x" ? 0 : actual.minor) <= maximum.minor;
}

function checkRevisionRange(actualRevision: string, pcsContract: { minimumRevision: string; maximumRevision: string }): CheckResult {
  const actual = parseRevision(actualRevision);
  const minimum = parseRevision(pcsContract.minimumRevision);
  const maximum = parseRevision(pcsContract.maximumRevision);
  if (!actual || !minimum || !maximum) {
    return { checkId: "contract.revisionRange", status: "WARNING", code: "PCS-DOC-3003", message: `Could not compare revisions: one of actual (${JSON.stringify(actualRevision)}), pcsContract.minimumRevision (${JSON.stringify(pcsContract.minimumRevision)}), or pcsContract.maximumRevision (${JSON.stringify(pcsContract.maximumRevision)}) does not match the "prefix-vMAJOR.MINOR" convention this comparison understands.` };
  }
  if (actual.prefix !== minimum.prefix || actual.prefix !== maximum.prefix) {
    return { checkId: "contract.revisionRange", status: "ERROR", code: "PCS-DOC-3001", message: `contractRevision prefix mismatch: response is ${JSON.stringify(actualRevision)}, manifest range uses prefix ${JSON.stringify(minimum.prefix)}. These are different contract families, not different versions of the same one.` };
  }
  if (!atLeast(actual, minimum) || !atMost(actual, maximum)) {
    return { checkId: "contract.revisionRange", status: "ERROR", code: "PCS-DOC-3001", message: `PCS returned contractRevision ${JSON.stringify(actualRevision)}, outside the manifest's declared range [${pcsContract.minimumRevision}, ${pcsContract.maximumRevision}]. Either PCS moved the contract forward past what this connector was built against, or the manifest's range is stale.` };
  }
  return { checkId: "contract.revisionRange", status: "PASS", code: "PCS-DOC-3001", message: `contractRevision ${JSON.stringify(actualRevision)} is within the manifest's declared range [${pcsContract.minimumRevision}, ${pcsContract.maximumRevision}].` };
}

/**
 * Validates a snapshot payload (e.g. the body returned by
 * `GET /v1/context/analysis-snapshot*`) against PCS's own schema validator,
 * and checks the returned contractRevision against the manifest's declared
 * range. Does not fetch anything itself -- callers pass in a payload they
 * already have (from a live probe, a fixture, or checker 3's own response),
 * keeping this checker a pure function and independently testable.
 *
 * Range-check caveat, found while testing this: `validateContextAnalysisSnapshot`
 * requires an *exact* match against a single hardcoded contractRevision
 * constant per schemaVersion (PCS_ANALYSIS_CONTRACT_REVISION /
 * PCS_ANALYSIS_CONTRACT_V3_REVISION) -- it has no concept of "an acceptable
 * range" itself. That means a payload can never reach this checker's range
 * comparison with a revision PCS's own validator wouldn't already accept.
 * In practice, the range check below only ever fires for the case where
 * PCS emits a revision it genuinely, validly supports, but the *manifest*
 * wasn't updated to include it -- a stale manifest, not a moving PCS
 * contract the manifest failed to anticipate. If PCS ever starts accepting
 * more than one contractRevision value at once (e.g. during a migration
 * window), this range check becomes meaningful in the other direction too.
 */
export function checkSnapshotContract(payload: unknown, manifest: ConnectorManifest): CheckResult[] {
  const results: CheckResult[] = [];

  let validated: unknown;
  try {
    validated = validateContextAnalysisSnapshot(payload);
  } catch (error) {
    results.push({ checkId: "contract.snapshotSchema", status: "ERROR", code: "PCS-DOC-3002", message: `Response failed PCS's own snapshot validator: ${error instanceof Error ? error.message : String(error)}.`, detail: { payloadSchemaVersion: isRecord(payload) ? payload.schemaVersion : undefined } });
    return results;
  }
  results.push({ checkId: "contract.snapshotSchema", status: "PASS", code: "PCS-DOC-3002", message: "Response passed PCS's snapshot validator." });

  const contractRevision = isRecord(validated) ? validated.contractRevision : undefined;
  if (typeof contractRevision !== "string") {
    // Legitimate for a V1 snapshot, which predates contractRevision entirely.
    results.push({ checkId: "contract.revisionRange", status: "INFO", code: "PCS-DOC-3003", message: "Response has no contractRevision field (this is expected for the legacy V1 snapshot schema, which predates contract revisioning). Range not checked." });
    return results;
  }
  if (!manifest.pcsContract) {
    // Shouldn't normally happen -- checkManifest (PCS-DOC-1006) requires
    // pcsContract when capabilities.readSnapshot is true, and this function
    // is only ever called on a snapshot response. Reported as ERROR rather
    // than silently skipped, since it means checker 1 either didn't run or
    // its result was ignored.
    results.push({ checkId: "contract.revisionRange", status: "ERROR", code: "PCS-DOC-3001", message: `Response declares contractRevision ${JSON.stringify(contractRevision)}, but the manifest has no pcsContract range to check it against.` });
    return results;
  }
  results.push(checkRevisionRange(contractRevision, manifest.pcsContract));
  return results;
}

/**
 * Sibling to checkSnapshotContract, for import-only connectors (e.g.
 * dev-pace's submit_import pipeline). Wraps `validateIntegrationImport`
 * instead of `validateContextAnalysisSnapshot`. Unlike the snapshot flow,
 * `IntegrationImportV1` has no schemaVersion/contractRevision field at all
 * (see ADR-022 Sequencing's "Before v0.2" entry), so there is no equivalent
 * of checkRevisionRange here -- there is nothing on the payload to range-check
 * against manifest.pcsContract, which is exactly why pcsContract is optional
 * for connectors that don't claim capabilities.readSnapshot.
 */
export function checkImportContract(payload: unknown): CheckResult[] {
  try {
    validateIntegrationImport(payload);
  } catch (error) {
    return [{ checkId: "contract.importSchema", status: "ERROR", code: "PCS-DOC-3002", message: `Payload failed PCS's own integration-import validator: ${error instanceof Error ? error.message : String(error)}.`, detail: { payloadSourceSystem: isRecord(payload) ? payload.sourceSystem : undefined } }];
  }
  return [{ checkId: "contract.importSchema", status: "PASS", code: "PCS-DOC-3002", message: "Payload passed PCS's integration-import validator." }];
}

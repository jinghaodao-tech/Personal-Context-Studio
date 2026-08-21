// `context-studio integration doctor <manifest.json>` -- CLI/CI entry point
// for ADR-022's Integration Doctor. This is the "manual/CI" tier; the
// "startup" tier lives in each connector's own process (see MeTheory's
// apps/api/src/pcsDoctor.ts for that side, built from this same package).
//
// Deliberately thin: all real logic lives in packages/integration-doctor.
// This file only reads a manifest file, wires the four checkers together
// against a live PCS, and formats/exits.

import { readFileSync } from "node:fs";
import {
  checkManifest,
  checkTransport,
  checkAuthenticationAndPermissions,
  checkSnapshotContract,
  buildReport,
  formatReportText,
  manifestChecksPassed,
  type ConnectorManifest,
  type CheckResult,
} from "../../../../packages/integration-doctor/src/index.ts";

export type IntegrationDoctorCommandOptions = { json: boolean };

export async function runIntegrationDoctorCommand(manifestPath: string, options: IntegrationDoctorCommandOptions): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ConnectorManifest;

  const manifestResults = checkManifest(manifest);
  const results: CheckResult[] = [...manifestResults];

  if (manifestChecksPassed(manifestResults)) {
    // Every live call below targets manifest.transport.baseUrl, not
    // PCS_API_URL / the CLI's own --json sibling `api` const. This is
    // deliberate: the point of the Doctor is "does the manifest's own
    // declared endpoint actually work", not "does some other PCS instance
    // the operator happens to be pointing the CLI at work" -- checker 3
    // (checkAuthenticationAndPermissions) already builds its own request
    // URLs from manifest.transport.baseUrl internally, so the contract
    // probe below matches it for consistency rather than introducing a
    // second, possibly-different target.
    results.push(...(await checkTransport(manifest, { timeoutMs: 5000 })));

    const credentials = { clientId: process.env.PCS_CLIENT_ID ?? "", token: process.env.PCS_CLIENT_TOKEN ?? "", profileId: process.env.PCS_PROFILE_ID };
    const authResults = await checkAuthenticationAndPermissions(manifest, credentials);
    results.push(...authResults);

    const readSnapshotOk = authResults.some((result) => result.checkId === "permission.read_snapshot" && (result.status === "PASS" || result.status === "INFO"));
    if (credentials.clientId && credentials.token && readSnapshotOk) {
      try {
        const baseUrl = manifest.transport.baseUrl.replace(/\/$/, "");
        const query = new URLSearchParams({ profileId: credentials.profileId ?? "" });
        const response = await fetch(`${baseUrl}/v1/context/analysis-snapshot-v3?${query}`, { headers: { "x-pcs-client-id": credentials.clientId, authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.timeout(5000) });
        if (response.ok) results.push(...checkSnapshotContract(await response.json(), manifest));
      } catch {
        // Best-effort, same reasoning as pcsDoctor.ts's startup check: a
        // network hiccup here shouldn't add a result on top of what the
        // permission probe above already reported for the same call.
      }
    }
  }

  const report = buildReport(manifest.connectorId, results);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportText(report));
  }

  if (report.status !== "PASS") process.exitCode = 1;
}

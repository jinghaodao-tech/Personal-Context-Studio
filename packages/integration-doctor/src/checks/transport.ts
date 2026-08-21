// Checker 2 of 5 (ADR-022): Transport Checker. Reuses PCS's own
// `localPcsUrl` primitive (packages/integration-contracts) rather than
// reimplementing the loopback rule -- the same rule the SDK and the API
// server itself enforce, so the Doctor cannot drift from what PCS actually
// requires.
//
// Reachability is a real network probe, not a ping to a dedicated health
// endpoint -- PCS has no such endpoint today. Any HTTP response (even a 404)
// proves a real PCS-shaped server answered; only a connection-level failure
// (refused, timed out, DNS failure) counts as unreachable. The fetch
// implementation is injectable so tests can run this deterministically
// without a live PCS process.

// Imports the compiled dist, not src -- this package is consumed
// externally (e.g. by MeTheory as a pinned git dependency, see ADR-022
// Sequencing), and only packages/integration-contracts/dist is committed
// and published (root package.json's "files"/"exports"). Importing src
// here would work inside this repo but break for any external consumer.
import { localPcsUrl } from "../../../integration-contracts/dist/index.js";
import type { CheckResult, ConnectorManifest } from "../types.ts";

export type TransportCheckOptions = {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  probeReachability?: boolean;
};

export async function checkTransport(manifest: ConnectorManifest, options: TransportCheckOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const baseUrl = manifest.transport?.baseUrl;

  let url: URL;
  try {
    url = localPcsUrl(baseUrl);
  } catch (error) {
    if (error instanceof Error && error.message === "pcs_localhost_required") {
      results.push({ checkId: "transport.localhost", status: "FATAL", code: "PCS-DOC-2002", message: `transport.baseUrl (${JSON.stringify(baseUrl)}) is not a loopback address. PCS only accepts http://127.0.0.1, http://localhost, or http://[::1].`, location: "$.transport.baseUrl" });
    } else {
      results.push({ checkId: "transport.parse", status: "FATAL", code: "PCS-DOC-2003", message: `transport.baseUrl (${JSON.stringify(baseUrl)}) could not be parsed as a URL.`, location: "$.transport.baseUrl" });
    }
    return results;
  }
  results.push({ checkId: "transport.localhost", status: "PASS", code: "PCS-DOC-2002", message: `transport.baseUrl (${url.toString()}) is loopback-only, as required.` });

  if (manifest.transport?.localhostOnly !== true) {
    results.push({ checkId: "transport.localhostOnlyFlag", status: "WARNING", code: "PCS-DOC-2002", message: "transport.localhostOnly is not explicitly true, even though PCS enforces loopback-only regardless. Declaring it keeps the manifest's stated intent honest.", location: "$.transport.localhostOnly" });
  }

  if (options.probeReachability === false) return results;

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  try {
    await fetchImplementation(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
    // Any response -- including a 404 for an unmatched path -- means
    // something answered at the transport level. What answered, and
    // whether it's really PCS, is the Authentication/Permission checker's
    // job (it calls a real, permission-mapped endpoint).
    results.push({ checkId: "transport.reachable", status: "PASS", code: "PCS-DOC-2001", message: `${url.toString()} answered an HTTP request within ${timeoutMs}ms.` });
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError" ? `did not respond within ${timeoutMs}ms` : "connection failed";
    results.push({ checkId: "transport.reachable", status: "FATAL", code: "PCS-DOC-2001", message: `${url.toString()} is unreachable: ${reason}.`, detail: { reason: String(error) } });
  }

  return results;
}

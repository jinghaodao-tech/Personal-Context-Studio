import { readFileSync } from "node:fs";
import { checkManifest, manifestChecksPassed, checkTransport, checkImportContract, buildReport, formatReportText } from "./packages/integration-doctor/dist/index.js";

const manifest = JSON.parse(readFileSync("/sessions/festive-awesome-gauss/mnt/dev-pace_public/docs/dev-pace-pcs-connector.manifest.json", "utf8"));

const manifestResults = checkManifest(manifest);
console.log("=== checkManifest ===");
for (const r of manifestResults) console.log(r.status.padEnd(7), r.checkId, "-", r.message);
console.log("manifestChecksPassed:", manifestChecksPassed(manifestResults));

const transportResults = await checkTransport(manifest, { probeReachability: false });
console.log("\n=== checkTransport (no network probe) ===");
for (const r of transportResults) console.log(r.status.padEnd(7), r.checkId, "-", r.message);

const lines = readFileSync("/sessions/festive-awesome-gauss/mnt/dev-pace/outputs/pcs_imports.jsonl", "utf8").trim().split("\n");
console.log(`\n=== checkImportContract against ${lines.length} real dev-pace import payloads ===`);
let importErrors = 0;
for (const line of lines) {
  const payload = JSON.parse(line);
  const results = checkImportContract(payload);
  for (const r of results) {
    if (r.status !== "PASS") { importErrors++; console.log(r.status, payload.id, "-", r.message); }
  }
}
console.log(`${lines.length - importErrors}/${lines.length} payloads passed validateIntegrationImport with 0 errors.`);

const report = buildReport("dev_pace", [...manifestResults, ...transportResults]);
console.log("\n=== Report ===");
console.log(formatReportText(report));

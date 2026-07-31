const baseUrl = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const headers = process.env.PCS_ADMIN_TOKEN ? { "x-pcs-admin-token": process.env.PCS_ADMIN_TOKEN } : {};
const json = process.argv.includes("--json");
async function get(path) { const response = await fetch(`${baseUrl}${path}`, { headers }); const body = await response.json(); return { ok: response.ok, status: response.status, body }; }
try {
  const [health, status] = await Promise.all([get("/health"), get("/v1/ops/status")]);
  const result = { ok: health.ok && status.ok, baseUrl, health: health.body, status: status.body };
  if (json) console.log(JSON.stringify(result, null, 2)); else { console.log(`PCS: ${result.ok ? "OK" : "FAILED"}`); console.log(`API: ${baseUrl}`); console.log(`Encryption: ${status.body.encryptionConfigured ? "configured" : "not configured"}`); console.log(`Migration count: ${status.body.migrationCount ?? "unknown"}`); console.log(`Watcher: ${status.body.watcher?.running ? "running" : "unknown/stopped"}`); }
  if (!result.ok) process.exitCode = 1;
} catch (error) { console.error(`PCS diagnostics failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }

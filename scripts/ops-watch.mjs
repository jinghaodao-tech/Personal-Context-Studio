const baseUrl = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const intervalMs = Math.max(1000, Number(process.env.PCS_OPS_INTERVAL_MS ?? 30000));
const once = process.argv.includes("--once");
const headers = process.env.PCS_ADMIN_TOKEN ? { "x-pcs-admin-token": process.env.PCS_ADMIN_TOKEN } : {};

async function check() {
  const [healthResponse, statusResponse] = await Promise.all([
    fetch(`${baseUrl}/health`, { headers }),
    fetch(`${baseUrl}/v1/ops/status`, { headers })
  ]);
  const health = await healthResponse.json();
  const status = await statusResponse.json();
  const ok = healthResponse.ok && statusResponse.ok;
  const result = { timestamp: new Date().toISOString(), ok, baseUrl, health: healthResponse.ok ? health : { status: healthResponse.status }, watcher: status?.watcher ?? null };
  console.log(JSON.stringify(result));
  return ok;
}

try {
  if (!(await check())) process.exitCode = 1;
  if (!once) {
    const timer = setInterval(async () => { try { if (!(await check())) process.exitCode = 1; } catch (error) { console.error(JSON.stringify({ timestamp: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message : "ops_watch_failed" })); process.exitCode = 1; } }, intervalMs);
    process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
    process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
  }
} catch (error) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message : "ops_watch_failed" }));
  process.exitCode = 1;
}

import { server, shutdown } from "./app.ts";
import { createLogger, readRuntimeConfig } from "../../../packages/runtime-ops/src/index.ts";

const config = readRuntimeConfig();
const logger = createLogger({ service: "pcs-api", file: process.env.PCS_LOG_FILE, maxBytes: Number(process.env.PCS_LOG_MAX_BYTES ?? 5 * 1024 * 1024) });
server.listen(config.port, "127.0.0.1", () => logger.info("API listening", { port: config.port, authRequired: config.authRequired }));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close(async () => { await shutdown(); process.exit(0); });
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });

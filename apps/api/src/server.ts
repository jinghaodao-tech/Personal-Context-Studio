import { server, shutdown } from "./app.ts";

const port = Number(process.env.PCS_PORT ?? 8300);
server.listen(port, "127.0.0.1", () => console.log(`Personal Context Studio listening on http://127.0.0.1:${port}`));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close(async () => { await shutdown(); process.exit(0); });
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
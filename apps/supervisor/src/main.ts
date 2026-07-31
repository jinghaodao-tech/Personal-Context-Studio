import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createLogger } from "../../../packages/runtime-ops/src/index.ts";

type ChildName = "api" | "watcher";
type ChildState = { pid: number | null; running: boolean; restartCount: number; lastExitAt?: string; lastError?: string };
const children = new Map<ChildName, ChildProcess>();
const states = new Map<ChildName, ChildState>();
const root = new URL("../../..", import.meta.url);
const statePath = resolve(process.env.PCS_SUPERVISOR_STATE ?? resolve(import.meta.dirname, "../../../data/supervisor-state.json"));
const restartBaseMs = Math.max(250, Number(process.env.PCS_SUPERVISOR_RESTART_DELAY_MS ?? 1000));
const maxBackoffMs = Math.max(restartBaseMs, Number(process.env.PCS_SUPERVISOR_MAX_BACKOFF_MS ?? 30000));
const logger = createLogger({ service: "pcs-supervisor", file: process.env.PCS_LOG_FILE, maxBytes: Number(process.env.PCS_LOG_MAX_BYTES ?? 5 * 1024 * 1024) });
let stopping = false;

function writeState() {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    const temporary = `${statePath}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, pid: process.pid, running: !stopping, updatedAt: new Date().toISOString(), children: Object.fromEntries(states) }, null, 2), "utf8");
    renameSync(temporary, statePath);
  } catch (error) {
    console.error(`Unable to write supervisor state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function start(name: ChildName, script: string) {
  if (stopping) return;
  const state = states.get(name) ?? { pid: null, running: false, restartCount: 0 };
  const child = spawn(process.execPath, ["--experimental-strip-types", script], { cwd: root, env: process.env, stdio: "inherit" });
  children.set(name, child);
  states.set(name, { ...state, pid: child.pid ?? null, running: true });
  writeState();
  child.once("error", (error) => { const current = states.get(name); states.set(name, { ...(current ?? state), lastError: error.message }); writeState(); });
  child.once("exit", (code, signal) => {
    if (children.get(name) !== child) return;
    children.delete(name);
    const current = states.get(name) ?? state;
    const restartCount = current.restartCount + 1;
    states.set(name, { ...current, pid: null, running: false, restartCount, lastExitAt: new Date().toISOString(), lastError: signal ?? (code === 0 ? undefined : `exit_${code ?? "unknown"}`) });
    writeState();
    if (stopping) return;
    const delay = Math.min(maxBackoffMs, restartBaseMs * (2 ** Math.min(restartCount - 1, 6)));
    logger.warn("Child stopped; scheduling restart", { child: name, reason: signal ?? code ?? "unknown", delayMs: delay, restartCount });
    setTimeout(() => start(name, script), delay).unref();
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill("SIGTERM");
  for (const [name, state] of states) states.set(name, { ...state, running: false, pid: null });
  writeState();
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
logger.info("Supervisor started", { statePath });
start("api", "apps/api/src/server.ts");
setTimeout(() => start("watcher", "apps/watcher/src/main.ts"), 500).unref();

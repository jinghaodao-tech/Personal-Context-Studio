import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
const secretKey = /(token|password|secret|api[_-]?key|authorization|cookie)/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[REDACTED]" : redact(item)]));
}

export function createLogger(options: { service: string; file?: string; maxBytes?: number }) {
  const file = options.file ? resolve(options.file) : undefined;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  function write(level: LogLevel, message: string, context: Record<string, unknown> = {}) {
    const safeContext = redact(context) as Record<string, unknown>;
    const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, service: options.service, message, ...safeContext });
    if (file) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        if (statSync(file, { throwIfNoEntry: false })?.size && statSync(file).size >= maxBytes) renameSync(file, `${file}.1`);
        appendFileSync(file, `${entry}\n`, "utf8");
      } catch { /* console output remains the fallback */ }
    }
    const output = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    output(entry);
  }
  return { debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context), info: (message: string, context?: Record<string, unknown>) => write("info", message, context), warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context), error: (message: string, context?: Record<string, unknown>) => write("error", message, context) };
}

export function readRuntimeConfig(env = process.env) {
  const port = Number(env.PCS_PORT ?? 8300);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PCS_PORT must be an integer between 1024 and 65535");
  const notesRoot = env.PCS_NOTES_DIR ?? "notes";
  const database = env.PCS_DB ?? "data/personal-context-studio.sqlite3";
  return { port, notesRoot: resolve(notesRoot), databasePath: resolve(database), authRequired: env.PCS_REQUIRE_AUTH === "1" };
}

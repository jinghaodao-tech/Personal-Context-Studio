import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const allowed = new Set([".ts", ".js", ".mjs", ".json", ".md", ".sql"]);
const ignored = new Set(["node_modules", ".git", "data"]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const failures = [];
function scan(directory) { for (const item of readdirSync(directory, { withFileTypes: true })) { if (ignored.has(item.name)) continue; const path = join(directory, item.name); if (item.isDirectory()) scan(path); else if (allowed.has(path.slice(path.lastIndexOf(".")))) { try { if (decoder.decode(readFileSync(path)).includes("\uFFFD")) failures.push(path); } catch { failures.push(path); } } } }
scan(process.cwd()); if (failures.length) { console.error(`Invalid UTF-8: ${failures.join(", ")}`); process.exitCode = 1; } else console.log("UTF-8 encoding check passed.");

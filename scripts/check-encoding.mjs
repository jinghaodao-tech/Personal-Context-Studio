import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const allowed = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".sql", ".yml", ".yaml", ".ps1", ".html", ".css"]);
const ignored = new Set(["node_modules", ".git", "data", "backups"]);
const ignoredFiles = new Set(["check-encoding.mjs"]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const failures = [];
const mojibake = /(?:\\u7e67|\\u7e3a|\\u873f|\\u83a0|\\u8b41)/;
function scan(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(item.name) || ignoredFiles.has(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) scan(path);
    else if (allowed.has(path.slice(path.lastIndexOf(".")))) {
      try {
        const value = decoder.decode(readFileSync(path));
        if (value.includes("\uFFFD") || value.includes("\u0000") || /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(value) || mojibake.test(value)) failures.push(path);
      } catch { failures.push(path); }
    }
  }
}
scan(process.cwd());
if (failures.length) { console.error(`Encoding check failed: ${failures.join(", ")}`); process.exitCode = 1; }
else console.log("UTF-8 encoding, control-character, and mojibake check passed.");
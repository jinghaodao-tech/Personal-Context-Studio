#!/usr/bin/env node
import { readFileSync } from "node:fs";

const api = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const json = process.argv.includes("--json");
async function request(path: string, init?: RequestInit) { const response = await fetch(`${api}${path}`, init); const value = await response.json(); if (!response.ok) throw new Error((value as any).error ?? `api_${response.status}`); return value; }
function print(value: unknown) { if (json) return console.log(JSON.stringify(value, null, 2)); if (typeof value === "object") return console.log(JSON.stringify(value, null, 2)); console.log(String(value)); }
async function main() {
  const [, , command, sub, ...args] = process.argv;
  if (command === "template" && sub === "list") return print(await request("/v1/context-templates"));
  if (command === "template" && sub === "create" && args[0]) return print(await request("/v1/context-templates", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "template" && sub === "activate" && args[0]) return print(await request(`/v1/context-templates/${encodeURIComponent(args[0])}/activate`, { method: "POST" }));
  if (command === "entry" && sub === "list") return print(await request("/v1/context-entries"));
  if (command === "entry" && sub === "create" && args[0]) return print(await request("/v1/context-entries", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "profile" && sub === "list") return print(await request("/v1/context-profiles"));
  if (command === "profile" && sub === "create" && args[0]) return print(await request("/v1/context-profiles", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "profile" && sub === "preview" && args[0]) return print(await request("/v1/context-exports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: args[0], format: args[1] ?? "markdown" }) }));
  if (command === "import" && sub === "metheory" && args[0]) return print(await request("/v1/context-imports/metheory", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "import" && sub === "list") return print(await request("/v1/context-imports"));
  if (command === "import" && sub === "decide" && args[0] && args[1]) return print(await request(`/v1/context-imports/${encodeURIComponent(args[0])}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: args[1], templateId: args[2], fieldKey: args[3] }) }));
  if (command === "export" && args[0]) return print(await request("/v1/context-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: args[0], format: args[1] ?? "markdown" }) }));
  throw new Error("usage: context-studio template|entry|profile|import|export ...");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLocalAiProvider } from "../../../packages/ai-core/src/index.ts";
import { extractDocumentValues } from "../../../packages/entry-extraction/src/index.ts";
import { readMarkdownSnapshot } from "../../../packages/documents/src/index.ts";
import type { ContextTemplateField } from "../../../packages/domain/src/index.ts";

const api = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const json = process.argv.includes("--json");
async function request(path: string, init?: RequestInit) { const response = await fetch(`${api}${path}`, init); const value = await response.json(); if (!response.ok) throw new Error((value as any).error ?? `api_${response.status}`); return value; }
function print(value: unknown) { if (json) return console.log(JSON.stringify(value, null, 2)); if (typeof value === "object") return console.log(JSON.stringify(value, null, 2)); console.log(String(value)); }
const notesRoot = resolve(process.env.PCS_NOTES_DIR ?? resolve(import.meta.dirname, "../../../notes"));
const provider = () => createLocalAiProvider({ provider: process.env.PCS_AI_PROVIDER, model: process.env.PCS_AI_MODEL, baseUrl: process.env.PCS_AI_BASE_URL });
const destinationHost = () => process.env.PCS_AI_DESTINATION_HOST ?? (process.env.PCS_AI_PROVIDER === "manual" ? "chatgpt.com" : process.env.PCS_AI_BASE_URL ?? "");
function fields(template: any): ContextTemplateField[] { return (template.fields as any[]).map((field) => ({ fieldKey: field.field_key, label: field.label, description: field.description, valueType: field.value_type, required: Boolean(field.required), displayOrder: field.display_order, options: JSON.parse(field.options_json ?? "[]"), minimum: field.minimum_value ?? undefined, maximum: field.maximum_value ?? undefined, unit: field.unit ?? undefined, analysisRole: field.analysis_role ?? undefined, analysisRoleConfirmed: Boolean(field.analysis_role_confirmed), analysisMergeAllowed: Boolean(field.analysis_merge_allowed), sharingDefault: field.sharing_default, sensitivity: field.sensitivity, reason: field.reason })); }
async function authorizeExternalExtraction(documentId: string, templateId: string, providerId: string) { const host = destinationHost(); if (providerId !== "manual") return; const authorization = await request("/v1/privacy/external-ai/authorize-extraction", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId, templateId, providerId, destinationHost: host }) }) as any; if (!authorization.allowed) throw new Error(`external_ai_consent_required:${[...authorization.missing, ...authorization.blockedFields].join(",")}`); }
async function generateTemplate(theme: string) { const current = provider(); if (!theme.trim()) throw new Error("template_theme_required"); if (current.id === "manual") return print({ provider: current.id, destinationHost: destinationHost(), prompt: current.manualTemplatePrompt?.({ theme }) }); const draft = await current.generateTemplateDraft({ theme }); return print(await request("/v1/context-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) })); }
async function extractDocument(documentId: string, templateId: string) { const current = provider(); const document = await request(`/v1/documents/${encodeURIComponent(documentId)}`) as any; const template = await request(`/v1/context-templates/${encodeURIComponent(templateId)}`) as any; const snapshot = readMarkdownSnapshot(notesRoot, document.item.file_path); const extractionInput = { documentId, template: { id: template.item.id, fields: fields(template.item) }, content: snapshot.content, sourceUpdatedAt: snapshot.sourceUpdatedAt, provider: current };
  await authorizeExternalExtraction(documentId, templateId, current.id);
  if (current.id === "manual") return print({ provider: current.id, destinationHost: destinationHost(), prompt: current.manualExtractionPrompt?.({ content: snapshot.content, template: extractionInput.template, sourceContentHash: snapshot.contentHash }) });
  const extraction = await extractDocumentValues(extractionInput); return print(await request("/v1/context-entries/candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId, sourceDocumentId: documentId, provider: extraction.result.providerId, values: extraction.result.values }) }));
}
async function main() {
  const [, , command, sub, ...args] = process.argv;
  if (command === "template" && sub === "list") return print(await request("/v1/context-templates"));
  if (command === "template" && sub === "create" && args[0]) return print(await request("/v1/context-templates", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "template" && sub === "activate" && args[0]) return print(await request(`/v1/context-templates/${encodeURIComponent(args[0])}/activate`, { method: "POST" }));
  if (command === "template" && sub === "generate" && args[0]) return generateTemplate(args.join(" "));
  if (command === "entry" && sub === "list") return print(await request("/v1/context-entries"));
  if (command === "entry" && sub === "create" && args[0]) return print(await request("/v1/context-entries", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "entry" && sub === "value-history" && args[0] && args[1]) return print(await request(`/v1/context-entries/${encodeURIComponent(args[0])}/values/${encodeURIComponent(args[1])}/revisions`));
  if (command === "entry" && sub === "revise" && args[0] && args[1] && args[2]) return print(await request(`/v1/context-entries/${encodeURIComponent(args[0])}/values/${encodeURIComponent(args[1])}/revisions`, { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[2], "utf8") }));
  if (command === "document" && sub === "list") return print(await request("/v1/documents"));
  if (command === "document" && sub === "sync" && args[0]) return print(await request("/v1/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filePath: args[0] }) }));
  if (command === "document" && sub === "search" && args[0]) return print(await request("/v1/documents/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: args.join(" ") }) }));
  if (command === "document" && sub === "excerpt" && args[0]) return print(await request(`/v1/documents/${encodeURIComponent(args[0])}/excerpt${args[1] ? `?maxCharacters=${encodeURIComponent(args[1])}` : ""}`));
  if (command === "document" && sub === "extract" && args[0] && args[1]) return extractDocument(args[0], args[1]);
  if (command === "ai" && sub === "status") return print(await request("/v1/local-ai/status"));
  if (command === "ai" && sub === "start") return print(await request("/v1/local-ai/start", { method: "POST" }));
  if (command === "ai" && sub === "stop") return print(await request("/v1/local-ai/stop", { method: "POST" }));
  if (command === "privacy" && sub === "external-ai-consents") return print(await request("/v1/privacy/external-ai-consents"));
  if (command === "privacy" && sub === "grant-external-ai" && args[0] && args[1] && args[2] && args[3]) return print(await request("/v1/privacy/external-ai-consents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: args[0], providerId: args[1], destinationHost: args[2], ...(args[0] === "document" ? { documentId: args[3] } : { templateId: args[3], fieldKey: args[4] }) }) }));
  if (command === "privacy" && sub === "revoke-external-ai" && args[0]) return print(await request(`/v1/privacy/external-ai-consents/${encodeURIComponent(args[0])}/revoke`, { method: "POST" }));
  if (command === "profile" && sub === "list") return print(await request("/v1/context-profiles"));
  if (command === "profile" && sub === "create" && args[0]) return print(await request("/v1/context-profiles", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "profile" && sub === "preview" && args[0]) return print(await request("/v1/context-exports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: args[0], format: args[1] ?? "markdown" }) }));
  if (command === "import" && sub === "metheory" && args[0]) return print(await request("/v1/context-imports/metheory", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "import" && sub === "list") return print(await request("/v1/context-imports"));
  if (command === "import" && sub === "decide" && args[0] && args[1]) return print(await request(`/v1/context-imports/${encodeURIComponent(args[0])}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: args[1], templateId: args[2], fieldKey: args[3] }) }));
  if (command === "export" && args[0]) return print(await request("/v1/context-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: args[0], format: args[1] ?? "markdown" }) }));
  if (command === "privacy" && sub === "safe-delete-plan" && args[0]) return print(await request("/v1/privacy/safe-delete/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId: args[0] }) }));
  if (command === "privacy" && sub === "safe-delete-execute" && args[0] && args[1] && args[2]) return print(await request("/v1/privacy/safe-delete/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId: args[0], planId: args[1], confirmation: args[2] }) }));
  if (command === "experiment" && sub === "request" && args[0]) return print(await request("/v1/experiment-template-requests", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "experiment" && sub === "list") return print(await request("/v1/experiment-template-requests"));
  if (command === "experiment" && sub === "create-template" && args[0]) return print(await request(`/v1/experiment-template-requests/${encodeURIComponent(args[0])}/create-template`, { method: "POST" }));
  if (command === "metheory" && sub === "analysis-snapshot") return print(await request(`/v1/metheory/analysis-snapshot${args[0] ? `?${args[0]}` : ""}`));
  throw new Error("usage: context-studio template|entry|profile|import|export ...");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

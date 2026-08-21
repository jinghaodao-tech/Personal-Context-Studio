#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLocalAiProvider } from "../../../packages/ai-core/src/index.ts";
import { extractDocumentValues } from "../../../packages/entry-extraction/src/index.ts";
import { readMarkdownSnapshot } from "../../../packages/documents/src/index.ts";
import type { ContextTemplateField } from "../../../packages/domain/src/index.ts";
import { createEditorAdapter, type EditorAdapterKind } from "../../../packages/integration-adapters/src/index.ts";
import { runIntegrationDoctorCommand } from "./commands/integration-doctor.ts";

const api = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const json = process.argv.includes("--json");
async function request(path: string, init?: RequestInit) { const response = await fetch(`${api}${path}`, { ...init, headers: { ...(process.env.PCS_ADMIN_TOKEN ? { "x-pcs-admin-token": process.env.PCS_ADMIN_TOKEN } : {}), ...(init?.headers ?? {}) } }); const value = await response.json(); if (!response.ok) throw new Error((value as any).error ?? `api_${response.status}`); return value; }
function print(value: unknown) {
  if (json) return console.log(JSON.stringify(value, null, 2));
  if (Array.isArray(value)) return value.forEach((item) => print(item));
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) console.log(`${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
    return;
  }
  console.log(String(value));
}
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
  if (command === "entry" && sub === "provenance" && args[0]) return print(await request(`/v1/context-entries/${encodeURIComponent(args[0])}/provenance`));
  if (command === "entry" && sub === "revise" && args[0] && args[1] && args[2]) return print(await request(`/v1/context-entries/${encodeURIComponent(args[0])}/values/${encodeURIComponent(args[1])}/revisions`, { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[2], "utf8") }));
  if (command === "entry" && sub === "review" && args[0] && args[1] && args[2]) return print(await request(`/v1/context-entries/${encodeURIComponent(args[0])}/values/${encodeURIComponent(args[1])}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: args[2], reason: args.slice(3).join(" ") || `Reviewed as ${args[2]}` }) }));
  if (command === "entry" && sub === "reconfirm" && args[0] && args[1]) return print(await request(`/v1/context-entries/${encodeURIComponent(args[0])}/values/${encodeURIComponent(args[1])}/reconfirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: args.slice(2).join(" ") || "Reconfirmed by user" }) }));
  if (command === "document" && sub === "list") return print(await request("/v1/documents"));
  if (command === "document" && sub === "sync" && args[0]) return print(await request("/v1/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filePath: args[0] }) }));
  if (command === "document" && sub === "search" && args[0]) return print(await request("/v1/documents/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: args.join(" ") }) }));
  if (command === "document" && sub === "excerpt" && args[0]) return print(await request(`/v1/documents/${encodeURIComponent(args[0])}/excerpt${args[1] ? `?maxCharacters=${encodeURIComponent(args[1])}` : ""}`));
  if (command === "document" && sub === "extract" && args[0] && args[1]) return extractDocument(args[0], args[1]);
  if (command === "ai" && sub === "status") return print(await request("/v1/local-ai/status"));
  if (command === "ai" && sub === "start") return print(await request("/v1/local-ai/start", { method: "POST" }));
  if (command === "ai" && sub === "stop") return print(await request("/v1/local-ai/stop", { method: "POST" }));
  if (command === "ops" && sub === "status") return print(await request("/v1/ops/status"));
  if (command === "privacy" && sub === "external-ai-consents") return print(await request("/v1/privacy/external-ai-consents"));
  if (command === "privacy" && sub === "grant-external-ai" && args[0] && args[1] && args[2] && args[3]) return print(await request("/v1/privacy/external-ai-consents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: args[0], providerId: args[1], destinationHost: args[2], ...(args[0] === "document" ? { documentId: args[3] } : { templateId: args[3], fieldKey: args[4] }) }) }));
  if (command === "privacy" && sub === "revoke-external-ai" && args[0]) return print(await request(`/v1/privacy/external-ai-consents/${encodeURIComponent(args[0])}/revoke`, { method: "POST" }));
  if (command === "profile" && sub === "list") return print(await request("/v1/context-profiles"));
  if (command === "profile" && sub === "create" && args[0]) return print(await request("/v1/context-profiles", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "profile" && sub === "preview" && args[0]) return print(await request("/v1/context-exports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: args[0], format: args[1] ?? "markdown" }) }));
  if (command === "sharing" && sub === "purposes") return print(await request("/v1/sharing-purposes"));
  if (command === "sharing" && sub === "create-purpose" && args[0]) return print(await request("/v1/sharing-purposes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: args[0], description: args.slice(1).join(" ") }) }));
  if (command === "sharing" && sub === "set-value-purposes" && args[0] && args[1]) return print(await request(`/v1/context-entries/${encodeURIComponent(args[0])}/values/${encodeURIComponent(args[1])}/purposes`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ purposeIds: args.slice(2) }) }));
  if (command === "integration" && sub === "import" && args[0]) return print(await request("/v1/integration-imports", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "integration" && sub === "imports") return print(await request("/v1/integration-imports"));
  if (command === "integration" && sub === "decide-import" && args[0] && args[1]) return print(await request(`/v1/integration-imports/${encodeURIComponent(args[0])}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: args[1], templateId: args[2], fieldKey: args[3] }) }));
  if (command === "export" && sub === "history") return print(await request("/v1/context-exports"));
  if (command === "export" && args[0]) return print(await request("/v1/context-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: args[0], format: args[1] ?? "markdown" }) }));
  if (command === "backup" && sub === "create") return print(await request("/v1/backups", { method: "POST" }));
  if (command === "backup" && sub === "list") return print(await request("/v1/backups"));
  if (command === "backup" && sub === "restore-plan" && args[0]) return print(await request(`/v1/backups/${encodeURIComponent(args[0])}/restore-plan`, { method: "POST" }));
  if (command === "backup" && sub === "restore" && args[0] && args[1] && args[2]) return print(await request(`/v1/backups/${encodeURIComponent(args[0])}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId: args[1], confirmation: args.slice(2).join(" ") }) }));
  if (command === "privacy" && sub === "safe-delete-plan" && args[0]) return print(await request("/v1/privacy/safe-delete/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId: args[0] }) }));
  if (command === "privacy" && sub === "safe-delete-execute" && args[0] && args[1] && args[2]) return print(await request("/v1/privacy/safe-delete/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId: args[0], planId: args[1], confirmation: args[2] }) }));
  if (command === "integration" && sub === "request-template" && args[0]) return print(await request("/v1/integration-template-requests", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(args[0], "utf8") }));
  if (command === "integration" && sub === "template-requests") return print(await request("/v1/integration-template-requests"));
  if (command === "integration" && sub === "create-template" && args[0]) return print(await request(`/v1/integration-template-requests/${encodeURIComponent(args[0])}/create-template`, { method: "POST" }));
  if (command === "integration" && sub === "analysis-snapshot") return print(await request(`/v1/context/analysis-snapshot${args[0] ? `?${args[0]}` : ""}`));
  if (command === "integration" && sub === "doctor" && args[0]) return runIntegrationDoctorCommand(args[0], { json });
  if (command === "adapter" && sub === "context" && args[0] && args[1]) {
    const kind = args[0] as EditorAdapterKind;
    if (!["vscode", "cursor", "obsidian"].includes(kind)) throw new Error("adapter_kind_invalid");
    const adapter = createEditorAdapter({ kind, baseUrl: api, clientId: process.env.PCS_CLIENT_ID ?? "", token: process.env.PCS_CLIENT_TOKEN ?? "", target: args[2] as any, detailLevel: (args[3] as any) ?? "standard" });
    return print(await adapter.getContext(args[1]));
  }
  throw new Error("usage: context-studio template|entry|profile|sharing|integration|export|backup ...");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

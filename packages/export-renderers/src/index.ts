export type ExportTarget =
  | "generic_ai_prompt"
  | "chatgpt_custom_instructions"
  | "claude_project_instructions"
  | "agents_md"
  | "markdown_manual"
  | "json";

export type RenderField = { label: string; fieldKey?: string; value: unknown };

export function normalizeExportTarget(target: unknown, format: unknown = "markdown"): ExportTarget {
  const value = typeof target === "string" ? target.trim().toLowerCase() : "";
  if (value === "generic_ai_prompt" || value === "prompt") return "generic_ai_prompt";
  if (value === "chatgpt_custom_instructions" || value === "chatgpt") return "chatgpt_custom_instructions";
  if (value === "claude_project_instructions" || value === "claude") return "claude_project_instructions";
  if (value === "agents_md" || value === "agents") return "agents_md";
  if (value === "markdown_manual" || value === "markdown") return "markdown_manual";
  if (value === "json") return "json";
  return normalizeExportTarget(format === "agents" ? "agents_md" : format === "chatgpt" ? "chatgpt_custom_instructions" : format);
}

export function storedFormat(target: ExportTarget): "markdown" | "json" | "agents" | "chatgpt" {
  if (target === "json") return "json";
  if (target === "agents_md") return "agents";
  if (target === "chatgpt_custom_instructions") return "chatgpt";
  return "markdown";
}

export function estimateTokens(value: string): number {
  return Math.max(0, Math.ceil([...value].length / 4));
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function renderTarget(fields: RenderField[], target: ExportTarget): string {
  if (target === "json") return JSON.stringify(Object.fromEntries(fields.map((item) => [item.fieldKey ?? item.label, item.value])), null, 2);
  const lines = fields.map((item) => `- ${item.label}: ${valueText(item.value)}`);
  if (target === "agents_md") return `# User Context\n\n${lines.join("\n")}`;
  if (target === "chatgpt_custom_instructions") return `Use the following user-approved context only when it is relevant. Do not treat it as a diagnosis or immutable identity.\n\n${lines.join("\n")}`;
  if (target === "claude_project_instructions") return `# Personal Context\n\nUse these user-confirmed facts as context. Ask before relying on sensitive or stale information.\n\n${lines.join("\n")}`;
  if (target === "generic_ai_prompt") return `The following context was explicitly approved by the user. Use it only for the stated task and do not infer sensitive facts.\n\n${lines.join("\n")}`;
  return `# Personal Context\n\n${lines.join("\n")}`;
}

export type DetailLevel = "short" | "standard" | "detailed";
export function renderTargetWithDetail(fields: RenderField[], target: ExportTarget, detailLevel: DetailLevel = "standard"): string {
  if (target === "json") return JSON.stringify({ schemaVersion: "pcs-context-snapshot-v2", detailLevel, values: Object.fromEntries(fields.map((item) => [item.fieldKey ?? item.label, item.value])) }, null, 2);
  const body = renderTarget(fields, target);
  if (detailLevel === "standard") return body;
  return "Detail level: " + detailLevel + ". Use this user-confirmed context only for the selected purpose.\\n\\n" + body;
}

function withinLimit(value: string, maximumCharacters: number | undefined, maximumTokens: number | undefined): boolean {
  return (maximumCharacters === undefined || value.length <= maximumCharacters) && (maximumTokens === undefined || estimateTokens(value) <= maximumTokens);
}

export function truncateRenderedTarget(fields: RenderField[], target: ExportTarget, maximumCharacters?: number, maximumTokens?: number, detailLevel: DetailLevel = "standard"): { content: string; truncated: boolean; includedFields: number } {
  const hasCharacterLimit = Number.isInteger(maximumCharacters) && (maximumCharacters as number) > 0;
  const hasTokenLimit = Number.isInteger(maximumTokens) && (maximumTokens as number) > 0;
  if (!hasCharacterLimit && !hasTokenLimit) return { content: renderTargetWithDetail(fields, target, detailLevel), truncated: false, includedFields: fields.length };
  const characterLimit = hasCharacterLimit ? maximumCharacters : undefined;
  const tokenLimit = hasTokenLimit ? maximumTokens : undefined;
  const complete = renderTargetWithDetail(fields, target, detailLevel);
  if (withinLimit(complete, characterLimit, tokenLimit)) return { content: complete, truncated: false, includedFields: fields.length };
  if (target === "json") {
    let included = 0;
    for (let count = fields.length; count >= 0; count -= 1) {
      const candidate = renderTargetWithDetail(fields.slice(0, count), target, detailLevel);
      if (withinLimit(candidate, characterLimit, tokenLimit)) { included = count; return { content: candidate, truncated: true, includedFields: included }; }
    }
    return { content: "{}", truncated: true, includedFields: 0 };
  }
  const marker = "\n\n[Some context was omitted because the configured export limit was reached.]";
  const lines = complete.split("\n");
  let output = "";
  for (const line of lines) {
    const candidate = output ? `${output}\n${line}` : line;
    if (!withinLimit(`${candidate}${marker}`, characterLimit, tokenLimit)) break;
    output = candidate;
  }
  return { content: `${output}${marker}`.trim(), truncated: true, includedFields: output ? Math.min(fields.length, output.split("\n").filter((line) => line.startsWith("- ")).length) : 0 };
}

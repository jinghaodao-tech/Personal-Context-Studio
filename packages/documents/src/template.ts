export type MarkdownTemplateField = {
  field_key: string;
  label: string;
  description?: string | null;
  value_type: string;
  required?: boolean | number;
  options?: Array<{ key: string; label: string }>;
  minimum_value?: number | null;
  maximum_value?: number | null;
  unit?: string | null;
};

function optionLines(field: MarkdownTemplateField): string {
  const options = Array.isArray(field.options) ? field.options.filter((item) => item && item.label) : [];
  if (!options.length) return "- 回答: ";
  if (field.value_type === "multi_choice") return options.map((item) => `- [ ] ${item.label}`).join("\\n");
  return `- 選択: ${options.map((item) => item.label).join(" / ")}\\n- 回答: `;
}

function fieldBlock(field: MarkdownTemplateField): string {
  const label = field.label.trim() || field.field_key;
  const description = field.description?.trim() ? `\\n> ${field.description.trim()}` : "";
  const required = field.required ? "\\n> 必須" : "";
  if (["boolean"].includes(field.value_type)) return `### ${label}${description}${required}\\n- [ ] はい\\n- [ ] いいえ`;
  if (["single_choice", "multi_choice"].includes(field.value_type)) return `### ${label}${description}${required}\\n${optionLines(field)}`;
  const range = field.minimum_value !== null && field.minimum_value !== undefined || field.maximum_value !== null && field.maximum_value !== undefined
    ? `\\n> 範囲: ${field.minimum_value ?? ""}〜${field.maximum_value ?? ""}${field.unit ? ` ${field.unit}` : ""}` : "";
  return `### ${label}${description}${required}${range}\\n- 回答: `;
}

export function templateMarker(templateId: string, version: number | string): string {
  return `<!-- pcs-template:${templateId}:v${version} -->`;
}

export function renderMarkdownTemplate(template: { id: string; name: string; version: number | string; description?: string | null; fields: MarkdownTemplateField[] }): string {
  const marker = templateMarker(template.id, template.version);
  const title = template.name.trim() || "記録テンプレート";
  const description = template.description?.trim() ? `\\n> ${template.description.trim()}` : "";
  const fields = [...template.fields].sort((a, b) => String(a.field_key).localeCompare(String(b.field_key)));
  return [marker, `## ${title}${description}`, ...fields.map(fieldBlock), `<!-- /pcs-template:${template.id}:v${template.version} -->`].join("\\n\\n");
}
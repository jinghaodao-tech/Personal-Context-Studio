import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownTemplate, templateMarker } from "../packages/documents/src/template.ts";

test("renders a deterministic Markdown template without values", () => {
  const template = { id: "template_demo", name: "日次記録", version: 2, description: "短い振り返り", fields: [
    { field_key: "mood", label: "気分", value_type: "single_choice", options: [{ key: "good", label: "良い" }, { key: "low", label: "低い" }] },
    { field_key: "note", label: "メモ", value_type: "short_text" }
  ] };
  const result = renderMarkdownTemplate(template);
  assert.match(result, /<!-- pcs-template:template_demo:v2 -->/);
  assert.match(result, /### 気分/);
  assert.match(result, /- 選択: 良い \/ 低い/);
  assert.match(result, /### メモ/);
  assert.match(result, /<!-- \/pcs-template:template_demo:v2 -->/);
  assert.equal(result.includes("undefined"), false);
  assert.equal(result.includes(templateMarker(template.id, template.version)), true);
});
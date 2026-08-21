import test from "node:test";
import assert from "node:assert/strict";
import { SEMANTIC_SENSITIVITY_TAXONOMY } from "../apps/api/src/semanticTaxonomy.ts";

test("semantic taxonomy defines include, exclude and hold boundaries for every product category", () => {
  for (const category of Object.values(SEMANTIC_SENSITIVITY_TAXONOMY)) {
    assert.ok(category.label);
    assert.ok(category.include.length > 0);
    assert.ok(category.exclude.length > 0);
    assert.ok(category.onHold.length > 0);
  }
});

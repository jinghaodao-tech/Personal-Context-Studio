import assert from "node:assert/strict";
import { test } from "node:test";
import { presidioFindingIsSensitive } from "../apps/api/src/presidioClient.ts";
test("Presidio findings use entity type and score", () => {
  assert.equal(presidioFindingIsSensitive({ entity_type: "EMAIL_ADDRESS", score: 0.99 }), true);
  assert.equal(presidioFindingIsSensitive({ entity_type: "HEALTH", score: 0.9 }), true);
  assert.equal(presidioFindingIsSensitive({ entity_type: "PERSON", score: 0.2 }), false);
  assert.equal(presidioFindingIsSensitive({ entity_type: "CUSTOM_ENTITY", score: 0.99 }), false);
});

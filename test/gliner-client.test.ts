import test from "node:test";
import assert from "node:assert/strict";
import { glinerFindingIsSensitive } from "../apps/api/src/glinerClient.ts";

test("GLiNER findings use label and score", () => {
  assert.equal(glinerFindingIsSensitive({ label: "personal health", score: 0.9 }), true);
  assert.equal(glinerFindingIsSensitive({ label: "personal health", score: 0.2 }), false);
  assert.equal(glinerFindingIsSensitive({ label: "ordinary topic", score: 0.99 }), false);
});

test("GLiNER person findings reject sentence fragments", () => {
  assert.equal(glinerFindingIsSensitive({ label: "person name", text: "健康状態を確認", score: 0.99 }), false);
  assert.equal(glinerFindingIsSensitive({ label: "person name", text: "山田太郎", score: 0.99 }), true);
  assert.equal(glinerFindingIsSensitive({ label: "person name", text: "佐々木小次郎", score: 0.99 }), true);
});

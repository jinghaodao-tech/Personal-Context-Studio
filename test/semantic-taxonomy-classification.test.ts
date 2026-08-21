import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySemanticSensitivity, classifySemanticSubject, hasSemanticExclusion } from "../apps/api/src/semanticTaxonomy.ts";

test("taxonomy classification returns category and disposition boundaries", () => {
  assert.deepEqual(classifySemanticSensitivity("本人の年収と家計を記録"), [{
    category: "income_finance", disposition: "include", matchedTerms: ["年収", "家計"],
  }]);
  assert.deepEqual(classifySemanticSensitivity("健康状態についてメモ"), [{
    category: "health_history", disposition: "on_hold", matchedTerms: ["健康状態"],
  }]);
  assert.deepEqual(classifySemanticSensitivity("電気代と商品価格"), []);
  assert.deepEqual(classifySemanticSensitivity("宗教ニュース"), []);
  assert.deepEqual(classifySemanticSensitivity("本人の宗教と信仰"), [{
    category: "religion_belief", disposition: "include", matchedTerms: ["宗教", "信仰"],
  }]);
  assert.deepEqual(classifySemanticSensitivity("宗教に関する活動"), [{
    category: "religion_belief", disposition: "on_hold", matchedTerms: ["宗教に関する活動"],
  }]);
  assert.deepEqual(classifySemanticSensitivity("自分の性的指向"), [{
    category: "sexual_orientation", disposition: "include", matchedTerms: ["性的指向"],
  }]);
  assert.deepEqual(classifySemanticSensitivity("好きなタイプについて"), [{
    category: "sexual_orientation", disposition: "on_hold", matchedTerms: ["好きなタイプ"],
  }]);
  assert.deepEqual(classifySemanticSensitivity("商品の価格と電気代"), []);
  assert.deepEqual(classifySemanticSensitivity("運動時間と健康記事"), []);
  assert.deepEqual(classifySemanticSensitivity("交際状況とデート履歴"), []);
  assert.equal(hasSemanticExclusion("健康記事を読んだ"), true);
  assert.equal(hasSemanticExclusion("宗教ニュースを読んだ"), true);
  assert.equal(hasSemanticExclusion("本人の病歴"), false);
  assert.equal(classifySemanticSubject("本人の病歴"), "owner");
  assert.equal(classifySemanticSubject("母の病歴"), "third_party");
  assert.equal(classifySemanticSubject("健康記事"), "generic");
});

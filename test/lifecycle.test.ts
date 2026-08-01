import assert from "node:assert/strict";
import test from "node:test";
import { rangesOverlap } from "../apps/api/src/routes/lifecycle.ts";

const item = (validFrom: string | null, validTo: string | null) => ({
  valueId: "value-1",
  applicabilityCondition: "workday",
  validFrom,
  validTo
});

test("applicability periods allow adjacent ranges but reject overlap", () => {
  assert.equal(rangesOverlap(item("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"), item("2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z")), false);
  assert.equal(rangesOverlap(item("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"), item("2026-01-31T00:00:00.000Z", "2026-03-01T00:00:00.000Z")), true);
  assert.equal(rangesOverlap(item(null, "2026-02-01T00:00:00.000Z"), item("2026-01-01T00:00:00.000Z", null)), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseDashboardOverview } from "../apps/api/src/dashboard/contracts.ts";

test("dashboard overview contract accepts counts and rejects malformed values", () => {
  assert.deepEqual(parseDashboardOverview({ confirmedValues: 2, pendingValues: 1, shareableValues: 1, retractedValues: 0 }), {
    confirmedValues: 2,
    pendingValues: 1,
    shareableValues: 1,
    retractedValues: 0
  });
  assert.throws(() => parseDashboardOverview({ confirmedValues: -1, pendingValues: 0, shareableValues: 0, retractedValues: 0 }), /dashboard_confirmed_values_invalid/);
  assert.throws(() => parseDashboardOverview({ confirmedValues: 1.5, pendingValues: 0, shareableValues: 0, retractedValues: 0 }), /dashboard_confirmed_values_invalid/);
});

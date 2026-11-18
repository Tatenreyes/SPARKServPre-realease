import assert from "node:assert/strict";
import test from "node:test";
import { getDashboardGreeting } from "../../src/lib/dashboard-greeting.ts";

test("dashboard greetings change at noon, 6 PM, and midnight in the Philippines", () => {
  for (const [utc, expected] of [
    ["2026-11-18T03:59:00Z", "Good morning"],
    ["2026-11-18T04:00:00Z", "Good afternoon"],
    ["2026-11-18T09:59:00Z", "Good afternoon"],
    ["2026-11-18T10:00:00Z", "Good evening"],
    ["2026-11-18T15:59:00Z", "Good evening"],
    ["2026-11-18T16:00:00Z", "Good morning"],
  ]) {
    assert.equal(getDashboardGreeting(new Date(utc)), expected, utc);
  }
});

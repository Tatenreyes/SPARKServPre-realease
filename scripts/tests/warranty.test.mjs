/**
 * Tests for reading a repair's workmanship warranty.
 *
 *   npm run test:warranty
 *
 * WHY THIS EXISTS. The warranty is stored per completed repair
 * (`service_history.warranty_days` / `warranty_until`, step 19) and was already
 * printed on the customer's job order and shown on the technician's Past jobs
 * list — but the ADMIN workspace, the one place where "is this still covered?"
 * decides whether a customer is charged again, showed nothing. Surfacing it put a
 * date column in front of a decision, so the reading has to be right:
 *
 *   1. `warranty_until` is a `date`, and `new Date("2026-12-04")` is UTC midnight
 *      — which renders as the 3rd for every user west of UTC. The date is parsed
 *      as a LOCAL calendar date, and this file proves it by reading the parsed
 *      parts back rather than by trusting a formatted string;
 *   2. days remaining are counted in whole days between two local midnights;
 *   3. the last day of cover is still cover;
 *   4. a repair with no date claims nothing, and so does an impossible date —
 *      never a guess, and never an error;
 *   5. the filter chip and the badge classify a repair identically, because they
 *      call the same function.
 *
 * The module is imported for real under Node's type stripping, so there is no
 * second copy of the rules to drift.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  WARRANTY_FILTER_LABELS,
  WARRANTY_FILTER_VALUES,
  WARRANTY_SOON_DAYS,
  parseCalendarDate,
  startOfDay,
  warrantyFilterKey,
  warrantyState,
} from "../../src/lib/warranty.ts";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

/** A fixed "today" so these tests never depend on when they run. */
const TODAY = new Date(2026, 11, 4); // 4 December 2026, local

// ------------------------------------------------- 1. the date is a calendar date

test("a warranty date is read as a local calendar date, not as UTC midnight", () => {
  const parsed = parseCalendarDate("2026-12-04");
  assert.ok(parsed, "a plain date must parse");
  // The bug this guards: `new Date("2026-12-04")` is 2026-12-04T00:00Z, which is
  // the 3rd of December anywhere west of UTC.
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 11);
  assert.equal(parsed.getDate(), 4);
  assert.equal(parsed.getHours(), 0, "the date is read at local midnight");
});

test("a full timestamp still yields its own calendar date", () => {
  const parsed = parseCalendarDate("2026-12-04T23:30:00+00:00");
  assert.ok(parsed);
  assert.equal(parsed.getDate(), 4);
});

test("an impossible date claims nothing instead of rolling over", () => {
  // JS would silently turn 2026-02-30 into the 2nd of March.
  assert.equal(parseCalendarDate("2026-02-30"), null);
  assert.equal(parseCalendarDate("2026-13-01"), null);
  assert.equal(parseCalendarDate("not-a-date"), null);
});

// ------------------------------------------------- 2. days left

test("days left is counted in whole days between local midnights", () => {
  const state = warrantyState("2026-12-10", TODAY);
  assert.equal(state.daysLeft, 6);
  // Six days is inside the warning window, so the badge is cautionary, not green.
  assert.equal(state.status, "expiring_soon");
  assert.equal(state.summary, "6 days left");
});

test("a comfortable amount of cover stays plain green", () => {
  const state = warrantyState("2026-12-24", TODAY);
  assert.equal(state.daysLeft, 20);
  assert.equal(state.status, "active");
  assert.equal(state.summary, "20 days left");
});

test("one day of cover is one day, not one days", () => {
  assert.equal(warrantyState("2026-12-05", TODAY).summary, "1 day left");
});

test("the last day of cover is still cover", () => {
  const state = warrantyState("2026-12-04", TODAY);
  assert.equal(state.daysLeft, 0);
  assert.equal(state.status, "expiring_soon");
  assert.equal(state.summary, "Ends today");
});

test("a repair whose cover ended yesterday says so", () => {
  const state = warrantyState("2026-12-03", TODAY);
  assert.equal(state.status, "expired");
  assert.equal(state.daysLeft, -1);
  assert.equal(state.summary, "Expired 1 day ago");
});

test("the soon window is the last seven days", () => {
  assert.equal(WARRANTY_SOON_DAYS, 7);
  assert.equal(warrantyState("2026-12-11", TODAY).status, "expiring_soon");
  assert.equal(warrantyState("2026-12-12", TODAY).status, "active");
});

// ------------------------------------------------- 3. nothing to claim

test("a repair with no warranty date claims nothing", () => {
  for (const value of [null, undefined, "", "   "]) {
    const state = warrantyState(value, TODAY);
    assert.equal(state.status, "none", `"${String(value)}" must not claim cover`);
    assert.equal(state.daysLeft, null);
    assert.equal(state.summary, "No warranty recorded");
  }
});

test("the badge and the technician's screen use the same words", () => {
  // One repair described two ways on two screens is how the workspace starts to
  // look unreliable, so the phrase is pinned to the wording already in use.
  assert.match(source("src/lib/warranty.ts"), /No warranty recorded/);
  assert.match(source("src/app/technician/past-jobs/page.tsx"), /No warranty recorded/);
});

// ------------------------------------------------- 4. the chip and the badge agree

test("the filter chip and the badge classify a repair identically", () => {
  assert.equal(warrantyFilterKey("2026-12-10", TODAY), "covered");
  assert.equal(warrantyFilterKey("2026-12-04", TODAY), "covered");
  assert.equal(warrantyFilterKey("2026-12-03", TODAY), "not_covered");
  assert.equal(warrantyFilterKey(null, TODAY), "not_covered");
});

test("the warranty facet's vocabulary and labels ship with the rule", () => {
  assert.deepEqual([...WARRANTY_FILTER_VALUES], ["covered", "not_covered"]);
  assert.deepEqual(WARRANTY_FILTER_LABELS, {
    covered: "Covered",
    not_covered: "Not covered",
  });
});

test("startOfDay keeps the calendar day and drops the clock", () => {
  const midday = new Date(2026, 11, 4, 12, 30, 45);
  const midnight = startOfDay(midday);
  assert.equal(midnight.getDate(), 4);
  assert.equal(midnight.getHours(), 0);
  assert.equal(midnight.getMinutes(), 0);
});

// ------------------------------------------------- 5. the admin screens show it

test("the warranty is on the two admin screens where it changes a decision", () => {
  const monitoring = source("src/app/admin/job-monitoring/page.tsx");
  assert.match(monitoring, /WarrantyBadge/, "job monitoring must show the cover");
  assert.match(monitoring, /Warranty<\/th>/, "and name the column");

  const payments = source("src/components/AdminPaymentsClient.tsx");
  assert.match(payments, /WarrantyBadge/, "the payments queue must show it before confirming");
  assert.match(payments, /warrantyFilterKey/, "and offer the covered/not-covered facet");
});

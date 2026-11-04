/**
 * Contract tests for the shared admin-list guards and the one "active" status set.
 *
 *   npm run test:admin-lists
 *
 * WHY THIS EXISTS. Two defects were found by review rather than by a test, and
 * both are the kind that silently comes back:
 *
 *   1. "Active" had three definitions — /admin/dashboard (four statuses),
 *      /admin/job-monitoring (four, inline) and /admin/progress (two) — so the
 *      same "Active Jobs" label showed different numbers on two pages of the
 *      same workspace. The fix is one list in `src/lib/booking-status.ts`; the
 *      test pins the list AND that the pages consume it instead of a local copy.
 *   2. Three admin listing pages discarded their query errors, so a failed
 *      SELECT rendered as "No bookings yet." — the same defect /admin/payments
 *      already fixed. `src/lib/query-rows.ts` is the guard; the pages must call
 *      it, and it must never log `details`/`hint` (they can echo row values).
 *
 * The modules are the REAL ones, imported under Node's type stripping, so there
 * is no second copy of the rule to drift. The page assertions are source-level
 * because the alternative would be a component runner this repository does not
 * have (see TESTING.md §5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ACTIVE_BOOKING_STATUSES, isActiveBookingStatus } from "../../src/lib/booking-status.ts";
import { QueryUnavailableError, optionalRows, requireRows } from "../../src/lib/query-rows.ts";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const PROGRESS = "src/app/admin/progress/page.tsx";
const MONITORING = "src/app/admin/job-monitoring/page.tsx";
const BOOKINGS = "src/app/admin/bookings/page.tsx";
const TECHNICIAN_JOBS = "src/components/TechnicianJobsClient.tsx";

// ------------------------------------------------- 1. one definition of "active"

test("the active set is exactly the four live statuses", () => {
  assert.deepEqual([...ACTIVE_BOOKING_STATUSES].sort(), [
    "awaiting_inspection",
    "awaiting_payment",
    "in_progress",
    "pending",
  ]);
});

test("a repair waiting on payment or verification is still active", () => {
  // The bug this guards: /admin/progress counted only pending + in_progress, so
  // a job that was physically finished but unpaid vanished from its monitor.
  assert.equal(isActiveBookingStatus("awaiting_payment"), true);
  assert.equal(isActiveBookingStatus("awaiting_inspection"), true);
  assert.equal(isActiveBookingStatus("completed"), false);
  assert.equal(isActiveBookingStatus("cancelled"), false);
  assert.equal(isActiveBookingStatus("something-unheard-of"), false);
});

test("both booking monitors read the shared list instead of a local one", () => {
  for (const path of [PROGRESS, MONITORING]) {
    const page = source(path);
    assert.match(page, /from "@\/lib\/booking-status"/, `${path} must use the shared list`);
    assert.doesNotMatch(
      page,
      /status === "(pending|in_progress|awaiting_inspection|awaiting_payment)"/,
      `${path} must not re-list the statuses inline — that is how the two pages drifted`
    );
  }
});

test("the technician job list uses the shared predicate too", () => {
  const client = source(TECHNICIAN_JOBS);
  assert.match(client, /isActiveBookingStatus/);
  assert.doesNotMatch(client, /b\.status === "awaiting_payment"/);
});

// ------------------------------------------- 2. no listing query is read unguarded

test("every admin listing page routes its reads through requireRows", () => {
  for (const path of [PROGRESS, MONITORING]) {
    const page = source(path);
    assert.match(
      page,
      /import \{ [^}]*requireRows[^}]*\} from "@\/lib\/query-rows"/,
      `${path} must import the guard`
    );
    assert.ok(
      [...page.matchAll(/requireRows\(/g)].length >= 4,
      `${path} must guard every query it reads`
    );
    // A bare destructure of `data` is exactly the shape that swallowed the error.
    assert.doesNotMatch(
      page,
      /const \{ data: (bookings|visits|requests|users|ratings|completedBookings|completedVisits) \}/,
      `${path} still reads a query result without the guard`
    );
  }
});

test("the guard throws, names the query, and carries the database code", () => {
  assert.throws(
    () => requireRows("bookings", null, { code: "42501", message: "permission denied" }),
    (err) => {
      assert.ok(err instanceof QueryUnavailableError);
      assert.equal(err.query, "bookings");
      assert.equal(err.code, "42501");
      return true;
    }
  );
});

test("the guard logs the code and message, and never the row-bearing fields", () => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    assert.throws(() =>
      requireRows("bookings", null, {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: "Key (gcash_reference)=(09171234567) already exists.",
        hint: "GRANT SELECT ON public.bookings TO anon;",
      })
    );
  } finally {
    console.error = original;
  }

  assert.equal(logged.length, 1);
  assert.match(logged[0], /\[admin\]/);
  assert.match(logged[0], /bookings/);
  assert.match(logged[0], /23505/);
  assert.doesNotMatch(logged[0], /09171234567/);
  assert.doesNotMatch(logged[0], /GRANT/i);
});

test("a successful read passes through untouched and logs nothing", () => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  let rows;
  try {
    rows = requireRows("bookings", [{ id: "b1" }], null);
  } finally {
    console.error = original;
  }
  assert.deepEqual(rows, [{ id: "b1" }]);
  assert.deepEqual(logged, []);
  assert.deepEqual(requireRows("bookings", null, null), []);
});

// ------------------------------------------- 2b. a migration that has not landed yet

test("a table that does not exist yet is tolerated, and a real failure is not", () => {
  const originalWarn = console.warn;
  const originalError = console.error;
  const warned = [];
  const errored = [];
  console.warn = (...args) => warned.push(args.join(" "));
  console.error = (...args) => errored.push(args.join(" "));

  let rows;
  let threw;
  let erroredWhileTolerating;
  try {
    // The table arrives with a migration that is deployed alongside the code and
    // applied to the database later. Until then it genuinely is not there, and
    // throwing would take down the whole admin screen over a feature that is merely
    // not switched on yet.
    rows = optionalRows("customer ratings", null, { code: "42P01", message: "relation does not exist" });
    rows = optionalRows("customer ratings", null, {
      code: "PGRST205",
      message: "Could not find the table in the schema cache",
    });
    // A column from the same migration reads the same way.
    rows = optionalRows("customer ratings", null, { code: "42703", message: "column does not exist" });
    erroredWhileTolerating = errored.length;

    // Everything else still fails loudly: this is the guard's whole point.
    try {
      optionalRows("bookings", null, { code: "42501", message: "permission denied" });
    } catch (error) {
      threw = error;
    }
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(rows, []);
  assert.ok(threw instanceof QueryUnavailableError, "a privilege refusal must still raise");
  assert.equal(threw.query, "bookings");
  assert.equal(erroredWhileTolerating, 0, "the tolerated path must not log an error");
  assert.equal(errored.length, 1, "while a real failure still logs one");
  assert.equal(warned.length, 3, "and must say, once per read, that the migration is pending");
  assert.match(warned[0], /not in the database yet/);
  assert.match(warned[0], /db:check/);
});

test("a successful read through the optional guard is unchanged", () => {
  assert.deepEqual(optionalRows("customer ratings", [{ id: "r1" }], null), [{ id: "r1" }]);
  assert.deepEqual(optionalRows("customer ratings", null, null), []);
});

// ------------------------------------------- 3. one list, one route

test("booking review is a redirect into the merged list", () => {
  const page = source(BOOKINGS);
  assert.match(page, /redirect\("\/admin\/job-monitoring"\)/);
  assert.doesNotMatch(page, /createServiceRoleClient|from\("bookings"\)/);
});

test("the merged list carries the column the removed page owned", () => {
  // Booking review was deleted because /admin/job-monitoring already showed the
  // same rows; its one unique column (Final cost) must survive the merge.
  assert.match(source(MONITORING), /Final cost/);
});

test("a refused visit write is surfaced instead of looking saved", () => {
  // VisitRowControl used to `await fetch(...)` and refresh without reading the
  // response, so a rejected PATCH was indistinguishable from a save.
  const client = source(TECHNICIAN_JOBS);
  const patch = client.slice(client.indexOf("async function patch"), client.indexOf("if (!res.ok)"));
  assert.ok(patch.length > 0, "the visit patch must still read its response");
  assert.match(client, /if \(!res\.ok\) throw new Error/);
});

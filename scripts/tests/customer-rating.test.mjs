/**
 * Contract tests for two-way ratings.
 *
 *   npm run test:customer-rating
 *
 * WHY THIS EXISTS. Ratings ran one way only — the customer scored the technician
 * after a completed repair, and the technician had no way to say how the visit went
 * for them. Every two-way marketplace asks both sides, so this closes the gap; and
 * a rating system that is half-built is worse than a one-way one, because the
 * numbers start to mean different things to different readers.
 *
 * The rules pinned here are the ones that make it fair rather than punitive, all
 * taken from how Uber and Grab actually run theirs:
 *
 *   1. the technician's PUBLIC average can never be built from their own opinions
 *      of customers — direction is by TABLE, not by a `rater_role` column, so no
 *      query can mix the two by accident;
 *   2. the published number is a ROLLING WINDOW, so a bad month is recoverable
 *      ("your rating is an average of the last 500 ratings", Uber);
 *   3. a habitually low rater is PROTECTED AGAINST — their scores are dropped, for
 *      both a technician and a customer ("we check whether the ratings a particular
 *      rider leaves are consistently low and remove these", Uber);
 *   4. no ratings is NEVER a score of zero;
 *   5. the REASON a score was given is recorded, only asked below five stars, and
 *      only the compliments are ever rendered to the other party;
 *   6. the customer's sentence is never forwarded to the technician — the
 *      notification carries the score and the reasons, not the text.
 *
 * The pure modules are imported for real under Node's type stripping. The route,
 * page and component assertions are source-level because this repository has no
 * component or request runner (see TESTING.md §5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CUSTOMER_TAGS,
  MAX_TAGS,
  TECHNICIAN_TAGS,
  labelForTag,
  positiveTagCounts,
  positiveTags,
  sanitizeTags,
  tagCounts,
} from "../../src/lib/rating-tags.ts";
import {
  HABITUAL_MINIMUM_RATINGS,
  RATING_WINDOW,
  formatSummary,
  habitualLowRaters,
  recentRatings,
  summariseRatings,
} from "../../src/lib/rating-summary.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

/**
 * Comments are stripped before scanning, exactly as `design-tokens.test.mjs` and
 * `user-guard.test.mjs` do. Without this the scan reads its own documentation: the
 * helper that publishes a technician's average explains in prose which table it
 * deliberately does NOT read, and the migration header quotes the policy it does
 * not touch.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const source = (path) => stripComments(read(path));

const PAGE = "src/app/admin/service-concerns/page.tsx";
const RATING_ROUTE = "src/app/api/bookings/[id]/rating/route.ts";
const REVERSE_ROUTE = "src/app/api/bookings/[id]/customer-rating/route.ts";
const REVERSE_FORM = "src/components/CustomerRatingForm.tsx";
const RATING_FORM = "src/components/RatingForm.tsx";
const MIGRATION = "supabase/migration_customer_ratings.sql";

// ------------------------------------------------- 1. the reason behind a score

test("only the tags the catalogue knows survive a submission", () => {
  assert.deepEqual(sanitizeTags("technician_rates_customer", ["no_access", "unsafe"]), [
    "no_access",
    "unsafe",
  ]);
  // Unknown keys, non-strings and duplicates are dropped rather than rendered.
  assert.deepEqual(
    sanitizeTags("technician_rates_customer", ["no_access", "no_access", "invented", 7, null]),
    ["no_access"]
  );
  // Not an array at all: nothing.
  assert.deepEqual(sanitizeTags("technician_rates_customer", "no_access"), []);
  assert.deepEqual(sanitizeTags("technician_rates_customer", undefined), []);
  // Catalogue order, not the order they were posted in.
  assert.deepEqual(sanitizeTags("technician_rates_customer", ["unsafe", "no_access"]), [
    "no_access",
    "unsafe",
  ]);
  assert.ok(sanitizeTags("technician_rates_customer", CUSTOMER_TAGS.map((t) => t.key)).length <= MAX_TAGS);
});

test("the two directions have their own vocabulary and never share one", () => {
  const technicianKeys = TECHNICIAN_TAGS.map((tag) => tag.key);
  const customerKeys = CUSTOMER_TAGS.map((tag) => tag.key);
  assert.equal(
    technicianKeys.some((key) => customerKeys.includes(key)),
    false,
    "a customer's tag must not be offerable on the technician's form, or vice versa"
  );
  assert.ok(technicianKeys.length >= 8 && customerKeys.length >= 6);
  // A key from the other direction is not a tag.
  assert.deepEqual(sanitizeTags("customer_rates_technician", ["no_access"]), []);
  assert.equal(labelForTag("technician_rates_customer", "no_access"), "Could not get access");
});

test("compliments are the only tags a counterpart may be shown", () => {
  const positives = positiveTags("technician_rates_customer").map((tag) => tag.key);
  assert.ok(positives.includes("ready_on_time"));
  assert.ok(!positives.includes("unsafe"), "friction stays with the platform");

  const counted = positiveTagCounts(
    [{ tags: ["ready_on_time", "unsafe"] }, { tags: ["ready_on_time"] }],
    "technician_rates_customer"
  );
  assert.deepEqual(counted, [{ key: "ready_on_time", label: "Was ready on time", count: 2 }]);
});

test("themes are counted, never attributed to a visit or a person", () => {
  const themes = tagCounts(
    [{ tags: ["left_a_mess"] }, { tags: ["left_a_mess", "late"] }],
    "customer_rates_technician"
  );
  assert.deepEqual(
    themes.map((theme) => [theme.key, theme.count]),
    [
      ["left_a_mess", 2],
      ["late", 1],
    ],
    "most-mentioned first, and no row identity anywhere in the result"
  );
  // A tag nobody used is not a theme.
  assert.equal(themes.some((theme) => theme.key === "tidy"), false);
  // An empty or absent list is an empty list, not a crash.
  assert.deepEqual(tagCounts(null, "customer_rates_technician"), []);
});

// ------------------------------------------------- 2. the rolling window

test("only the newest ratings count, so a bad month is recoverable", () => {
  assert.equal(RATING_WINDOW, 20);

  const rows = Array.from({ length: 25 }, (_, index) => ({
    rating: index < 5 ? 1 : 5,
    created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));

  // The 5 one-star ratings are the OLDEST, so a window of 20 drops all of them.
  const windowed = recentRatings(rows, 20);
  assert.equal(windowed.length, 20);
  assert.equal(
    windowed.some((row) => row.rating === 1),
    false
  );
  assert.equal(summariseRatings(rows).average, 5);
  assert.equal(summariseRatings(rows).total, 25, "the total still reports everything on record");
});

test("a corrupt row is not a zero and does not drag an average down", () => {
  assert.deepEqual(
    summariseRatings([{ rating: 5 }, { rating: Number.NaN }, { rating: null }, { rating: 9 }]),
    { average: 5, count: 1, total: 4, excluded: 0 }
  );
});

test("no ratings is not a score of zero", () => {
  const empty = summariseRatings([]);
  assert.deepEqual(empty, { average: null, count: 0, total: 0, excluded: 0 });
  assert.equal(formatSummary(empty), null);
  assert.equal(formatSummary(summariseRatings(null)), null);
  // And one decimal place, so a card never prints 4.833333333333333.
  assert.equal(formatSummary(summariseRatings([{ rating: 5 }, { rating: 5 }, { rating: 4 }])), "4.7");
});

// ------------------------------------------------- 3. protection

test("a habitually low rater is judged on their own record, and needs a record", () => {
  // Two 1-star ratings is not a pattern yet: the minimum is 3.
  assert.equal(HABITUAL_MINIMUM_RATINGS, 3);
  assert.deepEqual(
    [...habitualLowRaters([{ rater_id: "angry", rating: 1 }, { rater_id: "angry", rating: 2 }])],
    []
  );

  const flagged = habitualLowRaters([
    { rater_id: "angry", rating: 1 },
    { rater_id: "angry", rating: 2 },
    { rater_id: "angry", rating: 1 },
    { rater_id: "fair", rating: 5 },
    { rater_id: "fair", rating: 2 },
    { rater_id: "fair", rating: 5 },
  ]);
  assert.deepEqual([...flagged], ["angry"], "a fair rater with one bad day is not flagged");
});

test("protection is applied to the number, and the exclusion is reported", () => {
  const rows = [
    { rating: 1, rater_id: "angry" },
    { rating: 1, rater_id: "angry" },
    { rating: 1, rater_id: "angry" },
    { rating: 5, rater_id: "fair" },
    { rating: 4, rater_id: "fair" },
  ];
  const excluded = habitualLowRaters(rows);

  const unprotected = summariseRatings(rows);
  assert.equal(unprotected.average, 2.4);

  const protectedSummary = summariseRatings(rows, { excludeRaters: excluded });
  assert.equal(protectedSummary.average, 4.5, "the three 1-star rows are dropped");
  assert.equal(protectedSummary.count, 2);
  assert.equal(protectedSummary.excluded, 3);
});

// ------------------------------------------------- 4. the direction is a table

test("the migration keeps the two directions in separate tables", () => {
  const sql = source(MIGRATION);
  assert.match(sql, /create table if not exists public\.customer_ratings/);
  assert.match(sql, /add column if not exists tags text\[\]/, "the reason lives on `ratings`");
  // The unique key and the insert policy of the customer→technician table must not
  // be touched: that is what would let a technician's own ratings into their score.
  assert.doesNotMatch(sql, /alter table public\.ratings[\s\S]{0,200}drop constraint/i);
  assert.doesNotMatch(sql, /create policy[^;]*on public\.ratings/i);
  // Readable by the technician who wrote it and an administrator — never the customer.
  assert.match(sql, /using \(technician_id = auth\.uid\(\) or public\.is_admin\(\)\)/);
  assert.doesNotMatch(sql, /customer_id = auth\.uid\(\)[\s\S]{0,80}for select/i);
  assert.match(sql, /customer_ratings_version', '21'/);
});

test("the technician's published average cannot include their own ratings", () => {
  // The profile builder reads `ratings`; the technician's opinions live in
  // `customer_ratings`. Two files, two directions, no shared query.
  const profile = source("src/lib/technician-ratings.ts");
  assert.match(profile, /from\("ratings"\)/);
  assert.doesNotMatch(
    profile,
    /customer_ratings/,
    "a helper that publishes a technician's average must never read the table of their own opinions"
  );
  assert.match(profile, /habitualLowRaters/, "and it applies the protection");
  assert.match(profile, /recentRatings/, "and the window");
});

// ------------------------------------------------- 5. who writes one, and who reads it

test("the reverse route is technician-only, one per visit, and after the visit", () => {
  const route = source(REVERSE_ROUTE);
  assert.match(route, /user\.role !== "technician"/, "only a technician may rate a customer");
  assert.match(route, /booking\.technician_id !== user\.id/, "and only their own visit");
  assert.match(route, /RATEABLE_STATUSES/, "and only once the visit is over");
  assert.match(route, /"awaiting_inspection", "awaiting_payment", "completed"/);
  assert.doesNotMatch(route, /"pending", "in_progress"/, "not before the work is done");
  assert.match(route, /sanitizeTags\("technician_rates_customer"/, "tags are sanitised server-side");
  assert.match(route, /code === "23505"/, "a second rating is a 409, not a second row");
  assert.match(route, /from\("customer_ratings"\)/);
  // A low score tells the administrators, and only the administrators.
  assert.match(route, /LOW_RATING_ALERT_MAX = 2/);
  assert.match(route, /in\("role", \["admin", "super_admin"\]\)/);
  assert.match(route, /type: "customer_rating_low"/);
});

test("the customer is never told about the rating written about them", () => {
  const route = source(REVERSE_ROUTE);
  // The only notify() call in this route goes to admins; nothing addresses the
  // customer, and the body carries the tags rather than anybody's sentence.
  assert.equal(
    [...route.matchAll(/notify\(/g)].length,
    1,
    "exactly one notification, and it is the admin alert"
  );
  assert.match(route, /Reasons given:/);
  assert.doesNotMatch(route, /comment\.slice/, "a comment must never be forwarded");
});

test("the customer's own form offers reasons only below five stars", () => {
  const form = source(REVERSE_FORM);
  assert.match(form, /rating > 0 && rating <= 4/, "the reason is asked only when it means something");
  assert.match(form, /role="radiogroup"/, "the stars are one keyboard-reachable choice");
  assert.match(form, /aria-checked=\{rating === step\}/);
  assert.match(form, /MAX_TAGS/, "and the tag list is capped");
  assert.match(form, /Only you and an administrator can see this/);
  assert.match(form, /api\/bookings\/\$\{bookingId\}\/customer-rating/);
});

test("the customer's rating form carries tags, and the notification is anonymous", () => {
  const form = source(RATING_FORM);
  assert.match(form, /TECHNICIAN_TAGS/, "the customer picks from the technician catalogue");
  assert.match(form, /rating > 0 && rating <= 4/);
  assert.match(form, /tags/, "and the tags are sent with the score");

  const route = source(RATING_ROUTE);
  assert.match(route, /sanitizeTags\("customer_rates_technician"/);
  assert.match(route, /tags,/);
  // THE DEFECT THIS PINS: the technician's notification used to forward the
  // customer's own words, which is a breach of the anonymity rule every platform in
  // this space states plainly.
  assert.doesNotMatch(route, /comment\.slice\(0, 120\)/);
  assert.match(route, /Reasons given:/);
});

test("the two admin screens show both directions of a visit", () => {
  const monitoring = source("src/app/admin/job-monitoring/page.tsx");
  assert.match(monitoring, /from\("customer_ratings"\)/, "job monitoring reads the reverse rating");
  assert.match(monitoring, /Tech: ★/, "and renders it beside the customer's");

  const users = source("src/app/admin/users/page.tsx");
  assert.match(users, /from\("customer_ratings"\)/);
  assert.match(users, /summariseRatings/, "aggregated per customer");
  assert.match(users, /habitualLowRaters/, "with the same protection as the technician's average");
  assert.match(source("src/components/UserManagementClient.tsx"), /Tech rating/);
});

test("a customer can see their own score, and only as an aggregate", () => {
  const dashboard = source("src/app/customer/dashboard/page.tsx");
  assert.match(dashboard, /Your customer rating/);
  assert.match(dashboard, /positiveTagCounts/, "compliments only");
  assert.match(dashboard, /summariseRatings/);
  // The rows are anonymous to the customer by policy, so the page reads them with
  // the service-role client — and must not render a per-visit row.
  assert.match(dashboard, /createServiceRoleClient/);
  assert.doesNotMatch(dashboard, /customer_ratings[\s\S]{0,200}\.comment/, "never a comment");
});



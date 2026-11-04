/**
 * The technician's two lists: what still needs a quote, and what is finished.
 *
 *   npm run test:technician-assignments
 *
 * WHY THIS FILE EXISTS. A completed repair sat under "Accepted, send an estimate" on
 * `/technician/estimate-requests` for ever, with a live estimate form on it. The
 * server had already refused that form: `submit_estimate()` answers `request_closed`
 * and the route turns it into a 409, so the screen was offering an action that could
 * not succeed. The rule that decided it lived inline in the page, where no test could
 * reach it.
 *
 * The rule itself now lives in `src/lib/estimate-costs.ts` (`requestNeedsQuote`) and is
 * tested behaviourally in `scripts/tests/estimate-costs.test.mjs`. What is left here is
 * the WIRING — that the page actually uses that rule, that the query and the rule come
 * from one list, and that the archive page which replaced the missing one is wired to
 * the technician, reads only what a technician may read, and stays read-only.
 *
 * There is no route runner and no browser harness in this repository (TESTING.md §5),
 * so these read the sources as text. The behaviour of the rule is covered separately.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const PENDING = "src/app/technician/estimate-requests/page.tsx";
const PAST_JOBS = "src/app/technician/past-jobs/page.tsx";
const JOBS_CLIENT = "src/components/TechnicianJobsClient.tsx";
const NAV = "src/lib/navConfig.ts";

const pending = source(PENDING);
const pastJobs = source(PAST_JOBS);
const jobsClient = source(JOBS_CLIENT);
const nav = source(NAV);

// ------------------------------------------------- the list that was wrong

test("the pending list uses the shared rule instead of an inline one", () => {
  assert.match(
    pending,
    /import \{[^}]*requestNeedsQuote[^}]*\} from "@\/lib\/estimate-costs"/s,
    "the page must import the shared rule"
  );
  assert.match(pending, /requestNeedsQuote\(\{/, "and must call it");
  assert.match(pending, /requestStatus: request\.status/, "passing the REQUEST's status");
  assert.match(
    pending,
    /hasApprovedEstimate:/,
    "and whether anything was ever approved, the half that was missing"
  );
});

test("the old inline rule is gone, not merely shadowed", () => {
  // `if (!current) return true` treated "no live estimate" as "nothing sent yet",
  // which is also what an ACCEPTED estimate looks like from there.
  assert.doesNotMatch(
    pending,
    /if \(!current\) return true/,
    "the absence of a live estimate must not mean 'needs a quote'"
  );
  assert.doesNotMatch(pending, /needsEstimate/, "the old name must not linger");
});

test("closed requests are excluded in SQL, from the one list that defines them", () => {
  // One definition, two uses — the pattern `/customer/repairs/requests` already
  // follows. A hand-written pair here could drift from the predicate.
  assert.match(
    pending,
    /import \{[^}]*CLOSED_REQUEST_STATUSES[^}]*\}/s,
    "the statuses must come from the shared list"
  );
  assert.match(
    pending,
    /\.not\("status", "in", `\(\$\{CLOSED_REQUEST_STATUSES\.join\(","\)\}\)`\)/,
    "the query must filter closed requests using that list"
  );
});

test("a request is only considered after the assignment was accepted", () => {
  assert.match(pending, /\.eq\("assignment_status", "accepted"\)/);
  // `user.id`, not `user!.id`: the page reads its user through `requireUser()`,
  // which redirects instead of returning a null (see `npm run test:user-guard`).
  assert.match(pending, /\.eq\("assigned_technician_id", user\.id\)/);
});

// ------------------------------------------------- the record that was missing

test("past jobs exists as a technician route and reads the archive", () => {
  assert.match(pastJobs, /\.from\("service_history"\)/, "the archive is the source of finished work");
  assert.match(
    pastJobs,
    /\.eq\("technician_id", user\.id\)/,
    "scoped to the signed-in technician, the policy that already allows it"
  );
});

test("a past job carries the warranty the repair was sold with", () => {
  assert.match(pastJobs, /warranty_until/, "the expiry date is shown");
  assert.match(pastJobs, /warranty_days/, "and the term it was sold under");
  assert.match(
    pastJobs,
    /No warranty recorded for this repair/,
    "a repair archived before the warranty existed claims none, it does not borrow the default"
  );
});

test("past jobs publishes no customer contact detail", () => {
  // A technician may not read a customer's `users` row (the select policy is
  // `id = auth.uid() or is_admin()`), so a name join would silently render a blank.
  // Reaching the customer stays a thread on the booking page.
  assert.doesNotMatch(pastJobs, /\.from\("users"\)/, "no users join");
  assert.doesNotMatch(pastJobs, /\bemail\b/, "no email");
  assert.doesNotMatch(pastJobs, /\bphone\b/, "no phone number");
});

test("past jobs is read-only: a finished repair has nothing to update", () => {
  assert.doesNotMatch(pastJobs, /<form/, "no form");
  assert.doesNotMatch(pastJobs, /method: "POST"/, "no write");
  assert.doesNotMatch(pastJobs, /useRouter|router\.refresh/, "and nothing to refresh");
});

test("cancelled appointments are shown rather than lost", () => {
  // They are not in `service_history` — nothing was completed — so without their own
  // section a cancelled job would vanish from the technician's view entirely.
  assert.match(pastJobs, /\.eq\("status", "cancelled"\)/, "cancelled bookings are read");
  assert.match(pastJobs, /Cancelled appointments/, "and named");
});

// ------------------------------------------------- reaching it

test("the technician navigation and My jobs both link to past jobs", () => {
  assert.match(nav, /label: "Past Jobs", href: "\/technician\/past-jobs"/, "the sidebar must offer it");
  assert.match(jobsClient, /href="\/technician\/past-jobs"/, "My jobs must point at the full record");
  assert.match(jobsClient, /slice\(0, 5\)/, "My jobs is a short pointer, not a second archive");
});

test("the finished list on My jobs is clickable", () => {
  assert.match(
    jobsClient,
    /href=\{`\/technician\/bookings\/\$\{b\.id\}`\}/,
    "each finished job opens its booking"
  );
});


/**
 * Contract test: the customer-facing wording for an assignment state.
 *
 *   npm run test:queue-copy
 *
 * WHY THIS EXISTS. `waiting` is reached TWO ways — every qualified technician is
 * booked or at capacity for the slot, OR no approved technician covers the appliance
 * type at all. A technician who is not approved never enters the rotation
 * (`technician_eligibility_failure()` answers `not_available` for them, and
 * `not_in_queue` when they have no ACTIVE row in `technician_queue_state`), so a
 * request for an appliance nobody approved covers sits at `waiting` for ever.
 *
 * The customer page cannot tell those two apart, so its copy must not assert either
 * one. It used to say "Every qualified technician is booked or at capacity for that
 * slot" — a false reassurance. The live project had exactly that: Vacuum Cleaner,
 * Microwave Oven and Television requests at `waiting` with ZERO approved technicians
 * covering them.
 *
 * It runs the REAL module (`src/lib/queue.ts`). That module imports only types, so
 * Node's type stripping loads it with no build step and no second copy of the wording
 * to drift.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { customerAssignmentCopy, buildApplianceQueues, queueTurnNote } from "../../src/lib/queue.ts";

const STATES = ["matching", "offered", "waiting", "accepted", "something-unheard-of"];

test("every assignment state has a title and a body", () => {
  for (const status of STATES) {
    const copy = customerAssignmentCopy(status);
    assert.ok(copy.title?.trim(), `${status} needs a title`);
    assert.ok(copy.body?.trim(), `${status} needs a body`);
  }
});

test("the waiting copy does not claim a cause the page cannot know", () => {
  const text = customerAssignmentCopy("waiting").body.toLowerCase();

  assert.doesNotMatch(
    text,
    /every qualified technician/,
    "no page can know that EVERY qualified technician is busy"
  );
  assert.doesNotMatch(
    text,
    /at capacity for that slot/,
    "it may not be capacity at all — the appliance may not be covered yet"
  );
});

test("the waiting copy still promises the request keeps its place", () => {
  const text = customerAssignmentCopy("waiting").body.toLowerCase();

  assert.match(text, /stays in line/);
  assert.match(text, /match you/);
});

test("the waiting copy offers somewhere to go", () => {
  // `waiting` is the one state that can last indefinitely, so it is the one that needs
  // an escape hatch rather than a promise.
  assert.match(customerAssignmentCopy("waiting").body.toLowerCase(), /support/);
});

test("the waiting copy names the real reason when nobody covers the appliance", () => {
  const covered = customerAssignmentCopy("waiting", { qualifiedTechnicianAvailable: true });
  const uncovered = customerAssignmentCopy("waiting", { qualifiedTechnicianAvailable: false });
  const unknown = customerAssignmentCopy("waiting", { qualifiedTechnicianAvailable: null });

  // At least one technician qualifies → it IS a queue, and the copy must not claim
  // otherwise.
  assert.match(covered.title.toLowerCase(), /waiting/);
  assert.doesNotMatch(covered.title.toLowerCase(), /no technician/);

  // Confirmed nobody qualifies → say so plainly, keep the reassurance that the request
  // is saved, and stop pretending there is a queue worth waiting in.
  assert.match(uncovered.title.toLowerCase(), /no technician covers/);
  assert.match(uncovered.body.toLowerCase(), /saved/);
  assert.match(uncovered.body.toLowerCase(), /support/);
  assert.doesNotMatch(uncovered.body.toLowerCase(), /stays in line/);

  // Unknown → the neutral wording. Never a guess.
  assert.equal(unknown.title, covered.title);
  assert.equal(unknown.body, covered.body);
});

test("no other state's copy changes when coverage is known", () => {
  for (const status of ["matching", "offered", "accepted", "something-unheard-of"]) {
    assert.deepEqual(
      customerAssignmentCopy(status, { qualifiedTechnicianAvailable: false }),
      customerAssignmentCopy(status),
      `${status} must not react to coverage`
    );
  }
});

// ------------------------------------- the number that looked like a contradiction
//
// A technician who had just accepted two jobs read `#3` in one queue and `#4` in the
// other and reasonably asked why the work went to him. The engine was right: accepting
// consumes the turn and moves the technician to the END of the rotation, so the
// position is a snapshot taken AFTER the acceptance. The screen now says that.

/** A snapshot row, as `technician_queue_snapshot()` returns it. */
function snapshotRow(overrides = {}) {
  return {
    appliance_type: "aircon",
    queue_position: 3,
    technician_id: "tech-1",
    technician_name: "AMPOL",
    operational_status: "AVAILABLE",
    is_self: true,
    is_member_active: true,
    is_next_in_queue: false,
    queue_status: "IN_ROTATION",
    next_booking_at: null,
    current_job_until: null,
    active_offer_request_id: null,
    offers_expires_at: null,
    last_assigned_at: "2026-10-29T09:49:05.999261+00:00",
    ...overrides,
  };
}

test("the view model carries when the turn was last consumed", () => {
  const [queue] = buildApplianceQueues([snapshotRow()]);
  assert.equal(queue.myEntry.lastAssignedAt, "2026-10-29T09:49:05.999261+00:00");
});

test("the note explains the position instead of leaving it to look wrong", () => {
  const [queue] = buildApplianceQueues([snapshotRow()]);
  const note = queueTurnNote(queue);

  assert.ok(note, "a technician with a consumed turn gets the note");
  assert.match(note, /turn was last consumed/);
  assert.match(
    note,
    /end of this rotation/,
    "it must name the rule that produced the number"
  );
  // It explains a POSITION, it does not promise work — the same discipline the
  // customer-facing copy follows.
  assert.doesNotMatch(note, /next job is yours|you will get|guaranteed/i);
});

test("no note is invented when there is nothing to explain", () => {
  // Never accepted in this queue: a first turn cannot have been consumed.
  const [firstTurn] = buildApplianceQueues([snapshotRow({ last_assigned_at: null })]);
  assert.equal(queueTurnNote(firstTurn), null);

  // Out of the rotation: there is no position to explain.
  const [removed] = buildApplianceQueues([
    snapshotRow({ is_member_active: false, queue_status: "TEMPORARILY_REMOVED" }),
  ]);
  assert.equal(queueTurnNote(removed), null);

  // Not a member of this queue at all.
  const [other] = buildApplianceQueues([snapshotRow({ is_self: false })]);
  assert.equal(queueTurnNote(other), null);
});

test("a database without step 20 degrades to no note, never to a wrong one", () => {
  // The column is absent until the migration is applied, so it must not throw and
  // must not invent an acceptance.
  const row = snapshotRow();
  delete row.last_assigned_at;
  const [queue] = buildApplianceQueues([row]);

  assert.equal(queue.myEntry.lastAssignedAt, null);
  assert.equal(queueTurnNote(queue), null);
});

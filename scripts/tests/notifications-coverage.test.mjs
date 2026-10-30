/**
 * Coverage tests for the notification layer: every event that changes what somebody
 * must DO actually tells them.
 *
 *   npm run test:notifications
 *
 * These read the five routes as text — there is no route runner in this repository
 * (TESTING.md §4), so the wiring is what can be checked here. What each route does
 * with the database is covered by its own suite.
 *
 * WHY THIS FILE EXISTS. `notify()` existed and six call sites used it, but a
 * message, a confirmed appointment, a started repair, a finished repair, a
 * customer's inspection sign-off, an approved technician account and a rating all
 * changed somebody's next action without telling them. The screens were correct and
 * the events were silent — which is indistinguishable, to a customer, from a system
 * that has stopped working.
 *
 * The rules pinned here:
 *   * every one of those events notifies the party who did NOT act;
 *   * the notification is sent AFTER the write commits, never before it;
 *   * a failed notification can never fail the request it follows;
 *   * it is sent with a service-role client — a customer-role insert into
 *     `notifications` is refused by RLS, which is exactly how these events came to
 *     be silent in the first place.
 *
 * What is NOT covered here: delivery (push/SMS/email), the bell's rendering, and
 * whether the copy reads well to a real customer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const MESSAGES = "src/app/api/messages/route.ts";
const BOOKINGS = "src/app/api/bookings/route.ts";
const BOOKING_STATUS = "src/app/api/bookings/[id]/route.ts";
const RATING = "src/app/api/bookings/[id]/rating/route.ts";
const APPROVE = "src/app/api/technicians/[id]/approve/route.ts";

const messages = readFileSync(new URL(MESSAGES, ROOT), "utf8");
const bookings = readFileSync(new URL(BOOKINGS, ROOT), "utf8");
const bookingStatus = readFileSync(new URL(BOOKING_STATUS, ROOT), "utf8");
const rating = readFileSync(new URL(RATING, ROOT), "utf8");
const approve = readFileSync(new URL(APPROVE, ROOT), "utf8");

const routes = [
  ["messages", MESSAGES, messages],
  ["bookings POST", BOOKINGS, bookings],
  ["bookings PATCH", BOOKING_STATUS, bookingStatus],
  ["rating", RATING, rating],
  ["technician approval", APPROVE, approve],
];

// ------------------------------------------------- 1. every event speaks

test("every event that needs somebody to act notifies them", () => {
  for (const [name, path, source] of routes) {
    assert.match(
      source,
      /import \{ notify \} from "@\/lib\/notifications"/,
      `${name} (${path}) must import notify`
    );
    assert.match(source, /notify\(/, `${name} never calls notify`);
  }
});

test("each notification is sent after the write it describes", () => {
  // The write is the fact; the notification is the announcement. Sent first, it
  // could announce something that then failed.
  const orderings = [
    [MESSAGES, messages, "if (error) throw error;", "await notify(createServiceRoleClient()"],
    [RATING, rating, "const { data, error } = await supabase", "await notify(createServiceRoleClient()"],
    [BOOKINGS, bookings, 'rpc("create_booking_atomic"', "notifyBookedAppointment(serviceRole"],
    [BOOKING_STATUS, bookingStatus, ".update(updates)", "notifyStatusChange(serviceRole"],
    [APPROVE, approve, ".update({", "await notify(supabase"],
  ];
  for (const [path, source, write, notifyAt] of orderings) {
    const writeAt = source.indexOf(write);
    const notified = source.indexOf(notifyAt);
    assert.ok(writeAt > 0, `${path}: could not find the write (${write})`);
    assert.ok(notified > 0, `${path}: could not find the notification (${notifyAt})`);
    assert.ok(writeAt < notified, `${path}: the notification must follow the write`);
  }
});

test("a failed notification can never fail the request it follows", () => {
  for (const [name, path, source] of routes) {
    assert.match(
      source,
      /catch \(notifyError\)/,
      `${name} (${path}) must swallow a notification failure — the write already committed`
    );
  }
});

// ------------------------------------------------- 2. it is sent as the system

test("no route notifies with the caller's own client", () => {
  // A customer-role insert into `notifications` is refused by RLS, so a notification
  // sent with the browser client silently does nothing — the original bug.
  assert.match(messages, /notify\(createServiceRoleClient\(\)/, "messages");
  assert.match(rating, /notify\(createServiceRoleClient\(\)/, "rating");
  assert.match(bookings, /const serviceRole = createServiceRoleClient\(\)/, "bookings POST");
  assert.match(bookingStatus, /const serviceRole = createServiceRoleClient\(\)/, "bookings PATCH");
  assert.match(approve, /const supabase = createServiceRoleClient\(\)/, "the approval route");
});

// ------------------------------------------------- 3. the right recipient

test("the recipient is the party who did not act", () => {
  // Messages: the other participant, already validated by the route.
  assert.match(messages, /userId: receiver_id/);
  // A status change: derived from the actor, so whoever pressed the button is not
  // told what they just did.
  assert.match(bookingStatus, /recipientId === input\.actorId/, "never notify the actor");
  assert.match(
    bookingStatus,
    /const recipientIsCustomer = input\.actorRole !== "customer"/,
    "the recipient follows the actor"
  );
  // A rating is for the technician; an approval is for the technician.
  assert.match(rating, /userId: booking\.technician_id/);
  assert.match(approve, /userId: params\.id/);
});

test("a booking is announced to both parties", () => {
  assert.match(bookings, /userId: customerId/);
  assert.match(bookings, /userId: outcome\.technician_id/);
  assert.match(bookings, /outcome\.outcome === "booked"/, "only a committed booking is announced");
});

// ------------------------------------------------- 4. the copy carries a fact

test("the cancellation copy states the queue consequence", () => {
  // A technician who believes a cancellation cost them a turn stops accepting
  // offers, so the notification says what the queue actually did.
  assert.match(bookingStatus, /queue turn was not consumed/);
});

test("every notification carries a type and a link to act on", () => {
  for (const [name, , source] of routes) {
    // The type is a plain string except on a status change, where it is derived from
    // the new status (`booking_cancelled`), so both quote styles count.
    assert.match(source, /type: (approve \? )?["`]/, `${name} must set a type`);
    // `\s`, not a space: a long link expression is wrapped onto the next line.
    assert.match(source, /link:\s/, `${name} must link somewhere the reader can act`);
  }
});

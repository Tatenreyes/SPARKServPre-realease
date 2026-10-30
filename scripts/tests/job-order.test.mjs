/**
 * Unit tests for the job order: the reference number, the payment-reference rule
 * and everything `buildJobOrder()` decides.
 *
 *   npm run test:job-order
 *
 * These run the REAL module (`src/lib/job-order.ts`) — Node 24 strips the
 * TypeScript types, so there is no build step and no duplicated copy of the rules
 * to drift. The receipt route, the document and the print stylesheet are also
 * read as text, because a document nobody can reach or print is not a feature.
 *
 * WHY THIS FILE EXISTS. A repair used to end at a status of `completed` with the
 * evidence spread across five tables, so the customer held nothing. The rules that
 * matter when a document leaves the app are pinned here: an unverified payment
 * reference is never printed, a missing brand is omitted rather than rendered as
 * "null", the total is the stored figure and not one recomputed from the lines,
 * and the customer's own booking id is the only one that resolves.
 *
 * What is NOT covered here: the rendered document (see TESTING.md's manual pass),
 * the live database, and how the browser lays the page out on paper.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildJobOrder,
  jobOrderReference,
  maskPaymentReference,
} from "../../src/lib/job-order.ts";

const ROOT = new URL("../../", import.meta.url);
const LIB = "src/lib/job-order.ts";
const PAGE = "src/app/customer/bookings/[id]/receipt/page.tsx";
const DOCUMENT = "src/components/JobOrderDocument.tsx";
const BOOKING_PAGE = "src/app/customer/bookings/[id]/page.tsx";
const GLOBALS = "src/app/globals.css";
const TOPBAR = "src/components/DashboardTopbar.tsx";

const lib = readFileSync(new URL(LIB, ROOT), "utf8");
const page = readFileSync(new URL(PAGE, ROOT), "utf8");
const document = readFileSync(new URL(DOCUMENT, ROOT), "utf8");
const bookingPage = readFileSync(new URL(BOOKING_PAGE, ROOT), "utf8");
const globals = readFileSync(new URL(GLOBALS, ROOT), "utf8");
const topbar = readFileSync(new URL(TOPBAR, ROOT), "utf8");

/**
 * The file with its comments stripped.
 *
 * A guard that reads a source file as text must test the CODE, not the prose
 * explaining it: `JobOrderDocument`'s own header says "theme ink is near-white…" and
 * names `text-ink` while explaining why it is not used, which made the assertion
 * below fail on its first run. Comments are removed here so the assertion means what
 * it says.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const BOOKING = {
  id: "a1b2c3d4-0000-4000-8000-000000000000",
  scheduled_at: "2026-11-18T01:00:00.000Z",
  duration_minutes: 120,
  status: "completed",
  final_cost: 1850,
  inspection_note: "Cooling restored after cleaning the condenser.",
  inspection_confirmed_at: "2026-11-18T05:00:00.000Z",
};

/** A complete, healthy source. Each test overrides only what it is about. */
function source(overrides = {}) {
  return {
    booking: BOOKING,
    request: {
      appliance_type: "Refrigerator",
      issue_category: "Not cooling",
      problem_description: "Not cooling since Monday.",
    },
    appliance: { brand: "Condura", model_number: "RT32K", serial_number: "SN-001" },
    estimate: {
      labor_cost: 1000,
      parts_cost: 850,
      other_cost: 0,
      other_description: null,
      scope: "Replace the thermostat and clean the condenser.",
      estimated_cost: 1850,
    },
    payment: {
      amount: 1850,
      gcash_reference: "1234567890123",
      status: "confirmed",
      payment_date: "2026-11-18",
      confirmed_at: "2026-11-19T02:00:00.000Z",
    },
    history: { completed_at: "2026-11-19T02:00:00.000Z", summary: "Repair completed." },
    technicianName: "Juan Dela Cruz",
    ...overrides,
  };
}

// ------------------------------------------------- 1. the reference number

test("the reference is derived, stable and readable", () => {
  const reference = jobOrderReference(BOOKING.id, BOOKING.scheduled_at);
  assert.equal(reference, "SVC-20261118-A1B2C3");
  // Same booking, same reference — every time, in every process.
  assert.equal(jobOrderReference(BOOKING.id, BOOKING.scheduled_at), reference);
});

test("the reference reads the same from any timezone", () => {
  // 01:00Z is still 17 November in the Americas and already 18 November in
  // Manila. A reference that changed with the reader's clock would be useless as
  // a reference, so the date is taken in UTC on purpose.
  assert.equal(jobOrderReference(BOOKING.id, "2026-11-18T01:00:00.000Z"), "SVC-20261118-A1B2C3");
  assert.equal(jobOrderReference(BOOKING.id, "2026-11-18T23:30:00.000Z"), "SVC-20261118-A1B2C3");
});

test("a damaged or missing date cannot produce a nonsense reference", () => {
  assert.equal(jobOrderReference(BOOKING.id, "not a date"), "SVC-00000000-A1B2C3");
  assert.equal(jobOrderReference("", BOOKING.scheduled_at), "SVC-20261118-000000");
});

test("the reference never carries a whole identifier", () => {
  const reference = jobOrderReference(BOOKING.id, BOOKING.scheduled_at);
  assert.equal(reference.includes(BOOKING.id), false);
  assert.equal(reference.split("-")[2].length, 6);
});

// ------------------------------------------------- 2. the payment reference

test("a verified reference prints in full, an unverified one never does", () => {
  assert.equal(maskPaymentReference("1234567890123", true), "1234567890123");
  assert.equal(maskPaymentReference("1234567890123", false), "••••0123");
  // Nothing to mask with: print nothing rather than the whole value.
  assert.equal(maskPaymentReference("1234", false), "••••");
  assert.equal(maskPaymentReference("", false), "");
  assert.equal(maskPaymentReference(null, true), "");
  assert.equal(maskPaymentReference("  987654321  ", true), "987654321", "trimmed");
});

// ------------------------------------------------- 3. what the document says

test("the money is the stored figure, never one recomputed here", () => {
  const charged = buildJobOrder(source());
  assert.equal(charged.total, "₱1,850.00");

  // The technician recorded more than the estimate: the CHARGED amount is what
  // the document shows, because that is what the customer paid. The itemised
  // lines stay as approved — the difference is visible rather than papered over.
  const adjusted = buildJobOrder(
    source({ booking: { ...BOOKING, final_cost: 2000 } })
  );
  assert.equal(adjusted.total, "₱2,000.00");
  assert.equal(adjusted.charges.length, 2);

  // No recorded cost at all: fall back to the approved estimate.
  const fromEstimate = buildJobOrder(
    source({ booking: { ...BOOKING, final_cost: null } })
  );
  assert.equal(fromEstimate.total, "₱1,850.00");

  // Nothing was ever priced.
  const unpriced = buildJobOrder(
    source({ booking: { ...BOOKING, final_cost: null }, estimate: null })
  );
  assert.equal(unpriced.total, null, "the document prints 'To be confirmed'");
  assert.deepEqual(unpriced.charges, []);
});

test("labour and parts are always itemised, an extra charge only when it exists", () => {
  const plain = buildJobOrder(source());
  assert.deepEqual(
    plain.charges.map((charge) => charge.label),
    ["Labour", "Parts"]
  );
  assert.equal(plain.charges[0].amount, "₱1,000.00");
  assert.equal(plain.charges[1].amount, "₱850.00");

  const withExtra = buildJobOrder(
    source({
      estimate: {
        labor_cost: 1000,
        parts_cost: 500,
        other_cost: 350,
        other_description:  "Transport to the service centre",
        scope: "Replace the thermostat.",
        estimated_cost: 1850,
      },
    })
  );
  assert.equal(withExtra.charges.length, 3);
  assert.equal(withExtra.charges[2].label, "Additional charge");
  assert.equal(withExtra.charges[2].detail, "Transport to the service centre");
  assert.equal(withExtra.charges[2].amount, "₱350.00");
});

test("a missing appliance detail is omitted, never printed as null", () => {
  const full = buildJobOrder(source());
  assert.deepEqual(
    full.applianceFields,
    [
      { label: "Brand", value: "Condura" },
      { label: "Model number", value: "RT32K" },
      { label: "Serial number", value: "SN-001" },
    ]
  );

  const bare = buildJobOrder(
    source({ appliance: { brand: "  ", model_number: null, serial_number: "" } })
  );
  assert.deepEqual(bare.applianceFields, [], "nothing to print, so nothing is printed");

  const partial = buildJobOrder(
    source({ appliance: { brand: "LG", model_number: null, serial_number: null } })
  );
  assert.deepEqual(partial.applianceFields, [{ label: "Brand", value: "LG" }]);
});

test("the payment block exists only for a verified reference", () => {
  const verified = buildJobOrder(source());
  assert.deepEqual(verified.payment, {
    amount: "₱1,850.00",
    reference: "1234567890123",
    paidOn: "2026-11-18",
  });
  assert.equal(verified.paymentNote, "");

  for (const [status, expected] of [
    ["pending_verification", "awaiting verification"],
    ["rejected", "was not verified"],
  ]) {
    const pending = buildJobOrder(
      source({ payment: { ...source().payment, status } })
    );
    assert.equal(pending.payment, null, `${status}: an unverified reference is never printed`);
    assert.match(pending.paymentNote, new RegExp(expected));
  }

  const none = buildJobOrder(source({ payment: null }));
  assert.equal(none.payment, null);
  assert.match(none.paymentNote, /No payment reference is on record/);
});

test("the document describes the repair, and admits when it cannot", () => {
  const full = buildJobOrder(source());
  assert.equal(full.reportedProblem, "Not cooling");
  assert.equal(full.problemDescription, "Not cooling since Monday.");
  assert.equal(full.workPerformed, "Replace the thermostat and clean the condenser.");
  assert.equal(full.findings, "Cooling restored after cleaning the condenser.");
  assert.equal(full.summary, "Repair completed.");
  assert.equal(full.technicianName, "Juan Dela Cruz");
  assert.equal(full.warrantyUntil, null, "no warranty record, so no warranty claim");
  assert.equal(full.reference, "SVC-20261118-A1B2C3");

  // An unidentified problem is legitimate: the technician diagnoses on site.
  const vague = buildJobOrder(
    source({
      request: { appliance_type: "Freezer", issue_category: "  ", problem_description: "Making noise." },
      estimate: null,
      history: null,
      technicianName: "",
      appliance: null,
    })
  );
  assert.equal(vague.reportedProblem, null);
  assert.equal(vague.workPerformed, null);
  assert.equal(vague.completedAt, null);
  assert.equal(vague.technicianName, "your technician");
  assert.deepEqual(vague.applianceFields, []);
});

test("the workmanship warranty is printed only when a repair carries one", () => {
  // No archive row at all.
  assert.equal(buildJobOrder(source({ history: null })).warrantyUntil, null);

  // An archived repair with no warranty date — a row written before step 19, or a
  // shop that offers no workmanship warranty. The document claims nothing.
  assert.equal(
    buildJobOrder(
      source({ history: { completed_at: "2026-11-19T02:00:00.000Z", summary: null } })
    ).warrantyUntil,
    null,
    "no record, no claim"
  );

  // Step 19 stamped a date: it is carried through untouched.
  const covered = buildJobOrder(
    source({
      history: {
        completed_at: "2026-11-19T02:00:00.000Z",
        summary: "Repair completed.",
        warranty_until: "2026-12-19",
      },
    })
  );
  assert.equal(covered.warrantyUntil, "2026-12-19");
});

test("the warranty date is fetched, and read as a calendar date", () => {
  assert.match(
    lib,
    /\.select\("completed_at, summary, warranty_until"\)/,
    "the receipt cannot print a warranty the query never fetched"
  );
  assert.match(
    document,
    /parseIsoDate\(value\)/,
    "a `date` column read with new Date() renders a day early west of UTC"
  );
});

// ------------------------------------------------- 4. it is actually wired up

test("only the owning customer can resolve a job order", () => {
  assert.match(
    lib,
    /\.eq\("customer_id", options\.customerId\)/,
    "the ownership predicate belongs in the query, not only in the page"
  );
  assert.match(page, /if \(!loaded\) notFound\(\)/, "somebody else's booking is a 404");
  assert.match(page, /if \(!user\) redirect\("\/login"\)/, "no session, no document");
});

test("a job order is never assembled with a service-role client", () => {
  for (const [name, text] of [
    [LIB, lib],
    [PAGE, page],
    [DOCUMENT, document],
  ]) {
    assert.doesNotMatch(
      text,
      /createServiceRoleClient/,
      `${name} must read the customer's own record with the customer's own client`
    );
  }
});

test("an unfinished repair gets an explanation, not an empty document", () => {
  assert.match(page, /booking\.status !== "completed"/);
  assert.match(page, /issued when the repair is complete/);
  // The document is only rendered past that guard.
  const guard = page.indexOf('booking.status !== "completed"');
  const docAt = page.indexOf("<JobOrderDocument");
  assert.ok(guard > 0 && docAt > guard, "the document must sit after the guard");
});

test("the document is print-first, not screen-first", () => {
  const code = withoutComments(document);
  assert.doesNotMatch(code, /"use client"/, "no client JavaScript is needed to print");
  assert.doesNotMatch(
    code,
    /text-ink/,
    "theme ink is near-white in dark mode: a printed page would come out blank"
  );
  assert.doesNotMatch(code, /bg-surface|bg-canvas/, "the document is white on paper");
  assert.match(document, /print:shadow-none/);
  assert.match(document, /print:p-0/);
});

test("printing hides the app chrome, so the paper holds the document alone", () => {
  assert.match(globals, /@media print/, "the print block is missing");
  assert.match(globals, /#dashboard-sidebar[\s\S]{0,200}\.spark-bottom-nav/, "the sidebar and tab bar must hide");
  assert.match(globals, /@page/, "the printed page margin must be set");
  assert.match(topbar, /print:hidden/, "the topbar hides itself with the utility");
  assert.match(page, /print:hidden/, "the back link and the print button must not print");
});

test("the customer can find the job order from the booking", () => {
  assert.match(
    bookingPage,
    /href=\{`\/customer\/bookings\/\$\{booking\.id\}\/receipt`\}/,
    "the booking page must link to the receipt"
  );
  assert.match(bookingPage, /booking\.status === "completed" &&[\s\S]{0,200}receipt/);
});

test("the print control is the browser's own, and hides itself", () => {
  const button = readFileSync(new URL("src/components/PrintButton.tsx", ROOT), "utf8");
  assert.match(button, /"use client"/);
  assert.match(button, /window\.print\(\)/);
  assert.match(button, /print:hidden/);
  assert.doesNotMatch(button, /jspdf|pdf-lib|pdfkit/, "no PDF library: the browser prints");
});

/**
 * The job order — the document a completed repair leaves behind.
 *
 * ## Why this module exists
 *
 * SPARKServ's argument is that a repair should leave a record the customer can
 * hold. Service and repair enterprises are required to be DTI-accredited
 * (PD 1572; Art. 128, RA 7394) and the same framework expects an enterprise to
 * document the work performed, the parts used and the amount charged — but the
 * app used to end at a status of `completed`, with the evidence scattered across
 * five tables that only staff could assemble.
 *
 * This module turns those rows into ONE document: reference number, appliance,
 * reported problem, work performed, itemised charges, verified payment and the
 * sign-off. Money is formatted here, once, so the screen and the printout cannot
 * disagree.
 *
 * ## Deliberate limits
 *
 * * **An unverified reference is never printed.** A pending or rejected payment
 *   shows a sentence, never the GCash number — the document is evidence, and
 *   evidence nobody has checked is not evidence.
 * * **No invented rows.** A missing brand, model or serial is omitted rather than
 *   printed as "null", and a repair with no estimate falls back to the amount the
 *   technician recorded.
 * * **No warranty claim without a record.** `warrantyUntil` is printed only when
 *   the service history actually carries one (see the A6 service-warranty
 *   columns). Until then the document claims nothing.
 *
 * ## Pure on purpose
 *
 * `buildJobOrder()` is a pure function over already-fetched rows, so
 * `scripts/tests/job-order.test.mjs` runs the REAL rules with no database, no
 * React and no build step. `loadJobOrder()` receives the caller's Supabase client
 * as an argument instead of creating one — the module must stay importable
 * outside Next.js, and a job order is the customer's own record, so it must never
 * be assembled with a service-role client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApplianceRow,
  BookingRow,
  Database,
  EstimateRow,
  PaymentRow,
  ServiceHistoryRow,
  ServiceRequestRow,
} from "@/types/database";
import { formatMoney } from "./estimate-costs.ts";

/** One labelled line of the printed document. */
export interface JobOrderField {
  label: string;
  value: string;
}

/** One charge line. `detail` explains an additional charge, never a total. */
export interface JobOrderCharge {
  label: string;
  detail: string | null;
  amount: string;
}

/** The verified payment. Only ever built from a `confirmed` row. */
export interface JobOrderPayment {
  amount: string;
  reference: string;
  paidOn: string | null;
}

/** Everything the document renders — display-ready, no raw rows. */
export interface JobOrder {
  reference: string;
  scheduledAt: string;
  durationMinutes: number;
  completedAt: string | null;
  applianceType: string;
  applianceFields: JobOrderField[];
  reportedProblem: string | null;
  problemDescription: string;
  workPerformed: string | null;
  findings: string | null;
  summary: string | null;
  charges: JobOrderCharge[];
  /** The amount charged, or null when nothing was ever priced. */
  total: string | null;
  payment: JobOrderPayment | null;
  /** Shown in place of the payment block when there is no verified payment. */
  paymentNote: string;
  technicianName: string;
  /** Set only when the service history carries a warranty date (A6). */
  warrantyUntil: string | null;
}

/** The rows a job order is built from — already fetched, nothing inferred. */
export interface JobOrderSource {
  booking: Pick<
    BookingRow,
    | "id"
    | "scheduled_at"
    | "duration_minutes"
    | "status"
    | "final_cost"
    | "inspection_note"
    | "inspection_confirmed_at"
  >;
  request:
    | Pick<ServiceRequestRow, "appliance_type" | "issue_category" | "problem_description">
    | null;
  appliance: Pick<ApplianceRow, "brand" | "model_number" | "serial_number"> | null;
  estimate:
    | Pick<
        EstimateRow,
        "labor_cost" | "parts_cost" | "other_cost" | "other_description" | "scope" | "estimated_cost"
      >
    | null;
  payment:
    | Pick<PaymentRow, "amount" | "gcash_reference" | "status" | "payment_date" | "confirmed_at">
    | null;
  history: Pick<ServiceHistoryRow, "completed_at" | "summary" | "warranty_until"> | null;
  technicianName: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A stable reference number for one repair: `SVC-YYYYMMDD-XXXXXX`.
 *
 * Derived, never stored — there is no sequence to migrate and no counter to keep
 * consistent, and the same booking always produces the same reference.
 *
 * The date comes from the scheduled appointment **in UTC**, deliberately: the
 * number must read the same whether it is generated on the server, printed, or
 * read from another timezone. `XXXXXX` is the first six characters of the booking
 * id, which identifies the row without printing a whole identifier.
 */
export function jobOrderReference(bookingId: string, scheduledAt: string): string {
  const date = new Date(scheduledAt);
  const stamp = Number.isNaN(date.getTime())
    ? "00000000"
    : `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
  const suffix = (bookingId.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "000000").toUpperCase();
  return `SVC-${stamp}-${suffix}`;
}

/**
 * The GCash reference as it may appear on the document.
 *
 * A confirmed reference is printed in full — it is the proof the customer paid.
 * Anything unverified is masked to its last four digits, so a document that
 * leaves the app cannot leak a reference nobody has checked.
 */
export function maskPaymentReference(
  reference: string | null | undefined,
  confirmed: boolean
): string {
  const value = (reference ?? "").trim();
  if (!value) return "";
  if (confirmed) return value;
  // Too short to mask meaningfully: show nothing rather than the whole value.
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

/**
 * Turn fetched rows into the document. Pure — same input, same output, no I/O.
 *
 * The rules, all of which the test suite pins:
 *   * labour and parts are always shown (a repair that needed no parts says
 *     `₱0.00`, which is information, not noise);
 *   * an additional charge appears only when it is above zero, and always with
 *     the description the technician was required to give;
 *   * the total is what the technician recorded as `final_cost`, falling back to
 *     the approved estimate's stored `estimated_cost` — the figure
 *     `submit_estimate()` computed and `estimates_amounts_check` enforces. Never a
 *     sum recomputed from the lines here, and deliberately the same pair in the
 *     same order the booking page reads for the amount due, so the receipt and the
 *     payment screen can never quote different amounts;
 *   * an empty brand/model/serial is omitted rather than printed as a blank;
 *   * the payment block is built **only** from a `confirmed` row.
 */
export function buildJobOrder(source: JobOrderSource): JobOrder {
  const { booking, request, appliance, estimate, payment, history, technicianName } = source;

  const applianceFields: JobOrderField[] = [];
  const brand = (appliance?.brand ?? "").trim();
  const model = (appliance?.model_number ?? "").trim();
  const serial = (appliance?.serial_number ?? "").trim();
  if (brand) applianceFields.push({ label: "Brand", value: brand });
  if (model) applianceFields.push({ label: "Model number", value: model });
  if (serial) applianceFields.push({ label: "Serial number", value: serial });

  const charges: JobOrderCharge[] = [];
  if (estimate) {
    charges.push({ label: "Labour", detail: null, amount: formatMoney(estimate.labor_cost) });
    charges.push({ label: "Parts", detail: null, amount: formatMoney(estimate.parts_cost) });
    if (estimate.other_cost > 0) {
      charges.push({
        label: "Additional charge",
        detail: (estimate.other_description ?? "").trim() || null,
        amount: formatMoney(estimate.other_cost),
      });
    }
  }

  const total = booking.final_cost ?? estimate?.estimated_cost ?? null;

  const confirmed = payment?.status === "confirmed";
  const paymentBlock: JobOrderPayment | null =
    confirmed && payment
      ? {
          amount: formatMoney(payment.amount),
          reference: maskPaymentReference(payment.gcash_reference, true),
          paidOn: payment.payment_date ?? payment.confirmed_at ?? null,
        }
      : null;

  const paymentNote = confirmed
    ? ""
    : payment?.status === "pending_verification"
      ? "A payment reference has been submitted and is awaiting verification."
      : payment?.status === "rejected"
        ? "The last payment reference was not verified."
        : "No payment reference is on record for this repair.";

  return {
    reference: jobOrderReference(booking.id, booking.scheduled_at),
    scheduledAt: booking.scheduled_at,
    durationMinutes: booking.duration_minutes,
    completedAt: history?.completed_at ?? null,
    applianceType: (request?.appliance_type ?? "").trim() || "Appliance",
    applianceFields,
    reportedProblem: (request?.issue_category ?? "").trim() || null,
    problemDescription: request?.problem_description ?? "",
    workPerformed: (estimate?.scope ?? "").trim() || null,
    findings: (booking.inspection_note ?? "").trim() || null,
    summary: (history?.summary ?? "").trim() || null,
    charges,
    total: total == null ? null : formatMoney(total),
    payment: paymentBlock,
    paymentNote,
    technicianName: technicianName || "your technician",
    // The workmanship warranty, straight off the archive row (step 19). Null when
    // the repair predates the columns, and the document then claims nothing.
    warrantyUntil: (history?.warranty_until ?? "").trim() || null,
  };
}

/** What the receipt page needs: the guard fields plus the document. */
export interface LoadedJobOrder {
  booking: Pick<BookingRow, "id" | "status" | "service_request_id" | "scheduled_at">;
  jobOrder: JobOrder;
}

/**
 * Fetch everything one job order needs, scoped to the owning customer.
 *
 * The ownership predicate is in the QUERY (`customer_id = the caller`), not only
 * in the page, so a booking id belonging to somebody else returns `null` — the
 * same "404, not a page" rule the booking detail page follows. RLS refuses it a
 * second time; this is defence in depth, not the boundary.
 *
 * Every read uses the caller's own client. There is deliberately no service-role
 * path: a job order is the customer's record, and the one thing this module must
 * never do is assemble somebody else's.
 */
export async function loadJobOrder(
  supabase: SupabaseClient<Database>,
  options: { bookingId: string; customerId: string }
): Promise<LoadedJobOrder | null> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", options.bookingId)
    .eq("customer_id", options.customerId)
    .maybeSingle();

  if (!booking) return null;

  const { data: request } = await supabase
    .from("service_requests")
    .select("appliance_id, appliance_type, issue_category, problem_description")
    .eq("id", booking.service_request_id)
    .maybeSingle();

  let appliance: JobOrderSource["appliance"] = null;
  if (request?.appliance_id) {
    const { data } = await supabase
      .from("appliances")
      .select("brand, model_number, serial_number")
      .eq("id", request.appliance_id)
      .maybeSingle();
    appliance = data ?? null;
  }

  // The estimate this booking was made from. A booking created before
  // `estimate_id` existed has none, so the accepted estimate for the request is
  // the fallback — the same one the booking page uses to show the amount due.
  let estimate: JobOrderSource["estimate"] = null;
  if (booking.estimate_id) {
    const { data } = await supabase
      .from("estimates")
      .select("labor_cost, parts_cost, other_cost, other_description, scope, estimated_cost")
      .eq("id", booking.estimate_id)
      .maybeSingle();
    estimate = data ?? null;
  }
  if (!estimate) {
    const { data } = await supabase
      .from("estimates")
      .select("labor_cost, parts_cost, other_cost, other_description, scope, estimated_cost")
      .eq("service_request_id", booking.service_request_id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    estimate = data ?? null;
  }

  const { data: payment } = await supabase
    .from("payments")
    .select("amount, gcash_reference, status, payment_date, confirmed_at")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: history } = await supabase
    .from("service_history")
    .select("completed_at, summary, warranty_until")
    .eq("booking_id", booking.id)
    .maybeSingle();

  const { data: technician } = await supabase
    .from("users")
    .select("name")
    .eq("id", booking.technician_id)
    .maybeSingle();

  const jobOrder = buildJobOrder({
    booking,
    request,
    appliance,
    estimate,
    payment,
    history,
    technicianName: technician?.name ?? "",
  });

  return {
    booking: {
      id: booking.id,
      status: booking.status,
      service_request_id: booking.service_request_id,
      scheduled_at: booking.scheduled_at,
    },
    jobOrder,
  };
}

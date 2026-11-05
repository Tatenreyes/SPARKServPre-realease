import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import PaymentForm from "@/components/PaymentForm";
import { applianceLabel } from "@/lib/queue";
import { formatPeso } from "@/lib/customer-actions";
import type { BookingRow, PaymentRow } from "@/types/database";
import { CheckCircle2, ChevronRight, CircleDollarSign } from "lucide-react";

/**
 * The customer's payments: one row per completed repair, and what its money is
 * waiting on.
 *
 * Read with the same user-scoped client and the same two queries the dashboard's
 * "Payment outstanding" card uses (`payments` and `bookings` for this customer,
 * through RLS), so this page and the dashboard cannot disagree about which repair
 * still owes money. The amount is `final_cost` first, then the accepted estimate:
 * the same figure the payment API will accept.
 *
 * A repair appears once. Its newest payment row decides the state (paid, under
 * review, rejected); a completed booking with no payment row at all is "needs
 * payment". `PaymentForm` is reused unchanged for the two states that still need
 * the customer to type a reference, including its own rejection reason and its
 * re-submission behaviour.
 */
type PaymentState = "needs_payment" | "under_review" | "paid" | "rejected";

type PaymentItem = {
  bookingId: string;
  title: string;
  /** The row's date line, already formatted, and the value the list sorts by. */
  dateLine: string;
  sortAt: string;
  amount: number | null;
  state: PaymentState;
  payment: PaymentRow | null;
};

const STATE_LABEL: Record<PaymentState, string> = {
  needs_payment: "Needs payment",
  under_review: "Under review",
  paid: "Paid",
  rejected: "Rejected",
};

/** The status-chip recipe used everywhere else: a soft fill and its ink pair. */
const STATE_TONE: Record<PaymentState, string> = {
  needs_payment: "bg-warn-soft text-warn-ink",
  under_review: "bg-brand-soft text-brand-ink",
  paid: "bg-signal-soft text-signal-ink",
  rejected: "bg-alert-soft text-alert-ink",
};

/** The three checks a submitted reference passes through. */
const TIMELINE = ["Reference submitted", "Checked by SPARKServ", "Payment confirmed"];

function stateOf(payment: PaymentRow | null): PaymentState {
  if (!payment) return "needs_payment";
  if (payment.status === "confirmed") return "paid";
  if (payment.status === "rejected") return "rejected";
  return "under_review";
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function CustomerPayments({
  searchParams,
}: {
  searchParams?: { booking?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: payments }, { data: bookings }] = await Promise.all([
    supabase
      .from("payments")
      .select("*")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("*")
      .eq("customer_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  const bookingById = new Map((bookings ?? []).map((booking) => [booking.id, booking]));
  const completedBookings = (bookings ?? []).filter((booking) => booking.status === "completed");

  // Appliance names for the row titles, and the accepted estimate that stands in
  // for a final cost the technician has not recorded yet.
  const requestIds = Array.from(new Set((bookings ?? []).map((b) => b.service_request_id)));
  const { data: requests } = requestIds.length
    ? await supabase.from("service_requests").select("id, appliance_type").in("id", requestIds)
    : { data: [] };
  const { data: estimates } = requestIds.length
    ? await supabase
        .from("estimates")
        .select("service_request_id, estimated_cost, status")
        .in("service_request_id", requestIds)
    : { data: [] };

  const requestById = new Map((requests ?? []).map((request) => [request.id, request]));
  const acceptedCostByRequest = new Map(
    (estimates ?? [])
      .filter((estimate) => estimate.status === "accepted")
      .map((estimate) => [estimate.service_request_id, estimate.estimated_cost])
  );

  function titleOf(booking: BookingRow | undefined) {
    const request = booking ? requestById.get(booking.service_request_id) : undefined;
    return request ? `${applianceLabel(request.appliance_type)} repair` : "Repair";
  }

  function amountOf(booking: BookingRow | undefined) {
    if (!booking) return null;
    return booking.final_cost ?? acceptedCostByRequest.get(booking.service_request_id) ?? null;
  }

  const items: PaymentItem[] = [];

  // `payments` is ordered newest first, so the first row seen for a booking is
  // the one that decides its state.
  for (const payment of payments ?? []) {
    const booking = bookingById.get(payment.booking_id);
    items.push({
      bookingId: payment.booking_id,
      title: titleOf(booking),
      dateLine:
        booking?.status === "completed"
          ? `Completed ${formatDate(booking.updated_at)}`
          : `Reference sent ${formatDate(payment.created_at)}`,
      sortAt: payment.created_at,
      amount: payment.amount ?? amountOf(booking),
      state: stateOf(payment),
      payment,
    });
  }

  // Completed repairs with nothing submitted against them at all. `bookings`
  // carries no `completed_at`, so the completion is the row's last write.
  const bookingsWithPayment = new Set((payments ?? []).map((payment) => payment.booking_id));
  for (const booking of completedBookings) {
    if (bookingsWithPayment.has(booking.id)) continue;
    items.push({
      bookingId: booking.id,
      title: titleOf(booking),
      dateLine: `Completed ${formatDate(booking.updated_at)}`,
      sortAt: booking.updated_at,
      amount: amountOf(booking),
      state: "needs_payment",
      payment: null,
    });
  }

  items.sort((one, two) => new Date(two.sortAt).getTime() - new Date(one.sortAt).getTime());

  const selected = items.find((item) => item.bookingId === searchParams?.booking) ?? items[0] ?? null;
  const reached = selected?.state === "paid" ? TIMELINE.length : 1;
  const isUnderReview = selected?.state === "under_review";

  return (
    <div className="space-y-4 md:space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold text-ink sm:text-xl">Payments</h1>
          <p className="mt-0.5 text-sm text-muted">
            Every completed repair, and what its payment is waiting on.
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <section className="rounded-card border border-line bg-surface px-4 py-10 text-center shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:px-5">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted">
            <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">No payments yet</p>
          <p className="mt-1 text-xs text-muted">
            Payments for completed repairs will show up here.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5 xl:gap-5">
          {/* Stacked on a phone, two columns from `lg`: the repairs on the left,
              the selected one's money on the right. */}
          <ul className="space-y-2 lg:col-span-2">
            {items.map((item) => {
              const isSelected = item.bookingId === selected?.bookingId;
              return (
                <li key={item.bookingId}>
                  <Link
                    href={`/customer/payments?booking=${item.bookingId}`}
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex items-center gap-3 rounded-card border px-4 py-3 transition duration-200 ${
                      isSelected
                        ? "border-brand-300 bg-brand-soft/40"
                        : "border-line bg-surface hover:border-brand-300 hover:bg-soft"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {item.dateLine}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-semibold tabular-nums text-ink">
                        {item.amount != null ? formatPeso(item.amount) : "To be set"}
                      </span>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[item.state]}`}
                      >
                        {STATE_LABEL[item.state]}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="lg:col-span-3">
            {!selected ? null : selected.state === "needs_payment" ||
              selected.state === "rejected" ? (
              <div className="space-y-4">
                <section className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:p-5">
                  <h2 className="font-display text-base font-semibold text-ink">
                    {selected.title}
                  </h2>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] font-semibold text-muted">Amount</dt>
                      <dd className="text-sm text-ink">
                        {selected.amount != null
                          ? formatPeso(selected.amount)
                          : "Waiting for the technician's final cost"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold text-muted">Status</dt>
                      <dd className="text-sm text-ink">{STATE_LABEL[selected.state]}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-relaxed text-muted">
                    {selected.state === "rejected"
                      ? "The reference that was submitted was not accepted. Send a new one and an administrator will check it again."
                      : "Pay the technician via GCash, then submit the reference number so an administrator can verify it."}
                  </p>
                </section>

                {/* The same form the booking page renders, so its rejection reason,
                    its locked amount and its re-submission behave identically. */}
                <PaymentForm
                  bookingId={selected.bookingId}
                  existingPayment={selected.payment}
                  amountDue={selected.amount}
                />
              </div>
            ) : (
              <section className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-semibold text-ink">
                      {selected.title}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">{selected.dateLine}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATE_TONE[selected.state]}`}
                  >
                    {STATE_LABEL[selected.state]}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-semibold text-muted">Amount</dt>
                    <dd className="text-sm text-ink">
                      {selected.amount != null ? formatPeso(selected.amount) : "To be set"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-muted">GCash reference</dt>
                    <dd className="break-words text-sm text-ink">
                      {selected.payment?.gcash_reference ?? "Not recorded"}
                    </dd>
                  </div>
                </dl>

                <ol className="mt-5">
                  {TIMELINE.map((label, index) => {
                    const done = index < reached;
                    const current = !done && index === reached && isUnderReview;
                    return (
                      <li key={label} className="flex gap-3">
                        <span className="flex flex-col items-center">
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 text-signal-500" aria-hidden="true" />
                          ) : (
                            <span className="flex h-5 w-5 items-center justify-center">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${
                                  current ? "bg-brand-500" : "border-2 border-line"
                                }`}
                              />
                            </span>
                          )}
                          {index < TIMELINE.length - 1 && (
                            <span className="mt-1 h-7 w-px bg-line" aria-hidden="true" />
                          )}
                        </span>
                        <span
                          className={`pb-3 text-sm ${
                            done || current ? "font-medium text-ink" : "text-muted"
                          }`}
                        >
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                <p className="text-xs leading-relaxed text-muted">
                  {selected.state === "paid"
                    ? "This repair is paid and closed. Its job order is on the booking."
                    : "An administrator is checking the reference. The repair closes as soon as it is confirmed."}
                </p>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
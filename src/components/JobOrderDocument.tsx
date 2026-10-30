import type { JobOrder } from "@/lib/job-order";
import { parseIsoDate } from "@/lib/appliance-fields";

/**
 * The job order, as a document.
 *
 * ## Why the colours are hard-coded
 *
 * Every other component in this app draws with theme tokens (`text-ink`,
 * `bg-surface`) because the app is dark by default. A **document** must not: it is
 * read on paper, where `text-ink` is near-white and the page would come out
 * blank. So this component uses fixed ink-on-white values and lets the rest of
 * the app keep its theme. That is the reason it is a separate component rather
 * than another card on the booking page.
 *
 * ## Printing
 *
 * There is no PDF library. The browser already knows how to make one: the app
 * chrome hides itself with `print:hidden` (sidebar, topbar, bottom nav) and this
 * document drops its shadow and border, so "Print → Save as PDF" produces the
 * document and nothing else.
 *
 * The component is presentational and pure: it renders the object
 * `buildJobOrder()` produced and formats no money of its own — that happens once
 * in the module, so the screen and the paper cannot disagree.
 */
export default function JobOrderDocument({ jobOrder }: { jobOrder: JobOrder }) {
  return (
    <article className="mx-auto w-full max-w-[210mm] rounded-card border border-line bg-white p-6 text-[#111827] shadow-card sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D7DEE8] pb-5">
        <div>
          <p className="text-lg font-bold tracking-tight">SPARKServ</p>
          <p className="mt-0.5 text-xs uppercase tracking-[0.14em] text-[#5A6B82]">
            Appliance repair service
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#5A6B82]">
            Service job order
          </p>
          <p className="mt-1 font-mono text-sm font-semibold">{jobOrder.reference}</p>
        </div>
      </header>

      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <Field label="Service date" value={formatDateTime(jobOrder.scheduledAt)} />
          <Field label="Estimated duration" value={`${jobOrder.durationMinutes} minutes`} />
          {jobOrder.completedAt && (
            <Field label="Completed" value={formatDateTime(jobOrder.completedAt)} />
          )}
        </div>
        <div>
          <Field label="Technician" value={jobOrder.technicianName} />
          <Field label="Appliance" value={jobOrder.applianceType} />
          {jobOrder.applianceFields.map((field) => (
            <Field key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      </section>

      <Section title="Reported problem">
        {jobOrder.reportedProblem && (
          <p className="text-sm font-medium">{jobOrder.reportedProblem}</p>
        )}
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[#37455C]">
          {jobOrder.problemDescription || "No description was recorded."}
        </p>
      </Section>

      <Section title="Work performed">
        <p className="whitespace-pre-line text-sm leading-relaxed text-[#37455C]">
          {jobOrder.workPerformed ?? "No scope of work was recorded for this repair."}
        </p>
        {jobOrder.findings && (
          <p className="mt-3 text-sm leading-relaxed">
            <span className="font-semibold">Customer-confirmed findings: </span>
            <span className="text-[#37455C]">{jobOrder.findings}</span>
          </p>
        )}
        {jobOrder.summary && (
          <p className="mt-2 text-sm leading-relaxed">
            <span className="font-semibold">Service record: </span>
            <span className="text-[#37455C]">{jobOrder.summary}</span>
          </p>
        )}
      </Section>

      <Section title="Charges">
        {jobOrder.charges.length === 0 ? (
          <p className="text-sm text-[#37455C]">
            No itemised estimate is on record for this repair.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {jobOrder.charges.map((charge) => (
                <tr key={charge.label} className="border-b border-[#EDF1F6] last:border-0">
                  <td className="py-2 pr-4">
                    <span className="font-medium">{charge.label}</span>
                    {charge.detail && (
                      <span className="block text-xs text-[#5A6B82]">{charge.detail}</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{charge.amount}</td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 pr-4 font-semibold">Total</td>
                <td className="pt-3 text-right font-mono text-base font-bold tabular-nums">
                  {jobOrder.total ?? "To be confirmed"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Payment">
        {jobOrder.payment ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount paid" value={jobOrder.payment.amount} />
            <Field label="Reference" value={jobOrder.payment.reference} />
            <Field label="Paid on" value={formatDate(jobOrder.payment.paidOn)} />
          </div>
        ) : (
          <p className="text-sm text-[#37455C]">{jobOrder.paymentNote}</p>
        )}
      </Section>

      {jobOrder.warrantyUntil && (
        <Section title="Workmanship warranty">
          <p className="text-sm text-[#37455C]">
            Covered until{" "}
            <span className="font-semibold">{formatDate(jobOrder.warrantyUntil)}</span>.
          </p>
        </Section>
      )}

      <section className="mt-8 grid gap-8 sm:grid-cols-2">
        <SignatureLine label="Customer" />
        <SignatureLine label="Technician" />
      </section>

      <footer className="mt-8 border-t border-[#D7DEE8] pt-4 text-xs leading-relaxed text-[#5A6B82]">
        This job order records the appliance serviced, the work performed and the amount
        charged. Keep it for your records — it is the reference for any question about this
        repair. Reference {jobOrder.reference}.
      </footer>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#5A6B82]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="block text-xs uppercase tracking-[0.1em] text-[#5A6B82]">{label}</span>
      <span className="mt-0.5 block font-medium">{value}</span>
    </p>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <div className="h-10 border-b border-[#111827]" />
      <p className="mt-1.5 text-xs text-[#5A6B82]">{label}</p>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  // A CALENDAR date — `warranty_until` and `payment_date` are `date` columns — must
  // be read as a local calendar date. `new Date("2026-12-14")` is UTC midnight and
  // renders as the 13th anywhere west of UTC, which would print a warranty that
  // expires a day early; `parseIsoDate` exists in this project for exactly this.
  const calendar = parseIsoDate(value);
  const date = calendar ?? new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

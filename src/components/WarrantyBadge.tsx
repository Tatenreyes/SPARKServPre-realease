import { ShieldCheck } from "lucide-react";
import { parseCalendarDate, warrantyState, type WarrantyStatus } from "@/lib/warranty";

/**
 * The workmanship warranty a repair carries, as an admin reads it.
 *
 * The fact is stored per completed repair (`service_history.warranty_until`,
 * stamped by the step-19 trigger) and until now only the customer's job order and
 * the technician's Past jobs list showed it. The admin — the person who decides
 * whether the next visit is billable — saw nothing, which is how a repair inside
 * its own warranty window gets charged for twice.
 *
 * A server-safe component (no hooks, no state), so it renders identically inside
 * a server page and inside a client table.
 */

const TONE: Record<WarrantyStatus, string> = {
  active: "bg-signal-soft text-signal-ink",
  expiring_soon: "bg-warn-soft text-warn-ink",
  // Expired and "never recorded" are deliberately the same quiet grey: neither is
  // an alarm, and colouring an old repair red would make the column noisy.
  expired: "bg-soft text-muted",
  none: "bg-soft text-muted",
};

export default function WarrantyBadge({
  until,
  size = "md",
  withIcon = true,
}: {
  /** `service_history.warranty_until`, a `date` string, or null when there is none. */
  until: string | null | undefined;
  size?: "sm" | "md";
  withIcon?: boolean;
}) {
  const state = warrantyState(until);
  const expiry = parseCalendarDate(until);
  const date = expiry ? expiry.toLocaleDateString() : null;

  const text =
    state.status === "none"
      ? state.summary
      : state.status === "expired"
        ? `Warranty ended ${date}`
        : `Warranty until ${date} · ${state.summary}`;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[11px]"
      } ${TONE[state.status]}`}
    >
      {withIcon && <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {text}
    </span>
  );
}

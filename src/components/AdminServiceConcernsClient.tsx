"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import FilterDropdowns from "@/components/FilterDropdown";
import { buildFacets, rowMatches, type FacetSpec, type FilterSelection } from "@/lib/filter-options";
import type { SupportTicketRow, TicketStatus, TicketType, TicketPriority } from "@/types/database";

interface UserInfo {
  id: string;
  name: string;
  email: string;
}

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "resolved", "closed"];

/**
 * The workflow order the per-row `<select>` offers. It stays a workflow order —
 * open, in progress, resolved, closed is the sequence an admin works through —
 * while the filter dropdowns above the table are alphabetical, because a list
 * filter is scanned and a status control is followed.
 */
const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

const TYPE_OPTIONS: TicketType[] = [
  "product_inquiry",
  "billing_inquiry",
  "technical_issue",
  "other",
];

/**
 * Display names for the four stored types. The database values are unchanged —
 * `product_inquiry` was rendering as "Product Inquiry", which reads like an online
 * store rather than an appliance-repair service.
 */
const TYPE_LABEL: Record<TicketType, string> = {
  billing_inquiry: "Billing & payment",
  product_inquiry: "Service inquiry",
  technical_issue: "Technical issue",
  other: "Other",
};

const PRIORITY_ORDER: TicketPriority[] = ["critical", "high", "medium", "low"];

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: "bg-ink/5 text-ink/70",
  medium: "bg-brand-soft text-brand-ink",
  high: "bg-brand-soft text-brand-ink",
  critical: "bg-alert-soft text-alert-ink",
};

/**
 * The admin queue of SERVICE CONCERNS.
 *
 * The product noun is "concern"; the table is still `support_tickets` (see the
 * page's note and DATABASE.md). A concern is anything a customer raises that is
 * not a repair job — a complaint about one, an account or platform problem, a
 * warranty question, feedback — which is why the three facets below are Status,
 * Type and Priority rather than anything repair-shaped.
 */
export default function AdminServiceConcernsClient({
  initialTickets,
  userInfo,
}: {
  initialTickets: SupportTicketRow[];
  userInfo: Record<string, UserInfo>;
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterSelection>({});

  /**
   * Three facets, all multi-select, because these are the three questions an admin
   * actually asks of this queue: what still needs work (Status), what kind of
   * problem is it (Type — "only the technical issues"), and how urgent (Priority,
   * which keeps its severity order rather than an alphabetical one). Ticking two
   * statuses is an OR; the facets AND together.
   */
  const facets: FacetSpec<SupportTicketRow>[] = [
    {
      key: "status",
      label: "Status",
      values: STATUS_OPTIONS,
      labels: STATUS_LABEL,
      get: (ticket) => ticket.status,
    },
    {
      key: "type",
      label: "Type",
      values: TYPE_OPTIONS,
      labels: TYPE_LABEL,
      get: (ticket) => ticket.type,
    },
    {
      key: "priority",
      label: "Priority",
      values: PRIORITY_ORDER,
      labels: PRIORITY_LABEL,
      order: PRIORITY_ORDER,
      get: (ticket) => ticket.priority,
    },
  ];

  const groups = buildFacets(facets, tickets, filters);

  const filtered = tickets.filter((t) => {
    if (!rowMatches(facets, t, filters)) return false;
    if (!search) return true;
    const u = userInfo[t.user_id];
    // The message is searched too: it is the substance of a ticket, and an admin
    // hunting "refund" or a serial number is looking for text, not a subject line.
    const haystack = `${t.subject} ${t.message} ${u?.name ?? ""} ${u?.email ?? ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const narrowed = Object.values(filters).some((keys) => keys && keys.length > 0) || Boolean(search.trim());

  async function updateStatus(id: string, status: TicketStatus) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/support-tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (res.ok) {
        setTickets((prev) => prev.map((t) => (t.id === id ? json.data : t)));
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <Search className="h-4 w-4 text-ink/70" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search concerns by subject, message, or customer..."
          className="w-full text-sm outline-none"
        />
      </div>

      <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2.5">
        <FilterDropdowns groups={groups} selected={filters} onChange={setFilters} />
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="min-w-[720px] w-full text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink/70">
            <tr>
              <th className="px-4 py-3 font-medium">Concern</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Type &amp; Priority</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink/70">
                  {narrowed ? "No concerns match these filters." : "No concerns found."}
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const u = userInfo[t.user_id];
                return (
                  <tr key={t.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{t.subject}</p>
                      {/* The body of the ticket. Until now the admin screen showed
                          only the subject, so a ticket could be resolved without
                          anyone having read what the customer wrote. */}
                      <p className="mt-0.5 line-clamp-2 max-w-md text-xs leading-relaxed text-ink/70">
                        {t.message}
                      </p>
                      <p className="mt-0.5 text-xs text-ink/70">
                        {new Date(t.created_at).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink/70">{u?.name ?? "N/A"}</p>
                      <p className="text-xs text-ink/70">{u?.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-ink/70">{TYPE_LABEL[t.type]}</p>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${PRIORITY_COLOR[t.priority]}`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={t.status}
                        disabled={busyId === t.id}
                        onChange={(e) => updateStatus(t.id, e.target.value as TicketStatus)}
                        className="rounded-lg border border-line px-2 py-1 text-xs capitalize"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s} className="capitalize">
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

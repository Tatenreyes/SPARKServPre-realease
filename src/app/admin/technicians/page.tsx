import Link from "next/link";
import { Search } from "lucide-react";
import { createServiceRoleClient } from "@/lib/supabase/server";
import ApproveTechnicianButton from "@/components/ApproveTechnicianButton";
import RepairTechnicianRecordsButton from "@/components/RepairTechnicianRecordsButton";
import { FilterDropdownLinks } from "@/components/FilterDropdown";
import {
  buildFacets,
  resolveActive,
  rowMatches,
  type FacetSpec,
} from "@/lib/filter-options";
import type { OperationalStatus, TechnicianRow } from "@/types/database";

/** Display names for the operational states; the bar sorts them A→Z. */
const OPERATIONAL_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  ON_JOB: "On a job",
  SCHEDULED: "Scheduled",
  TEMPORARILY_UNAVAILABLE: "Temporarily unavailable",
  OFFLINE: "Offline",
  SUSPENDED: "Suspended",
};

const OPERATIONAL_VALUES: OperationalStatus[] = [
  "AVAILABLE",
  "ON_JOB",
  "SCHEDULED",
  "TEMPORARILY_UNAVAILABLE",
  "OFFLINE",
  "SUSPENDED",
];

export default async function AdminTechniciansPage({
  searchParams,
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  const supabase = createServiceRoleClient();

  // THIS PAGE IS READ-ONLY, deliberately — rendering it must never write a row.
  //
  // It used to promote every auth user whose signup metadata said `technician`, with
  // the service role. `user_metadata` is writable by the account holder
  // (`supabase.auth.updateUser({ data: { role: "technician" } })`), and the trigger
  // that refuses self-promotion (`prevent_role_change()`) exempts the service role —
  // so any customer could become a technician by editing their own metadata and
  // waiting for an administrator to open this screen. It was also a write on a GET:
  // a prefetch or a refresh performed it, with no decision taken and no record of who
  // took it.
  //
  // The repair it performed still exists, as an explicit administrator action:
  // `POST /api/admin/technicians/repair` (the control below). That endpoint only ever
  // creates MISSING rows, so it cannot promote anybody; changing an existing account's
  // role remains a super-admin action (`PATCH /api/users/[id]/role`).
  const { data: technicians, error: techniciansError } = await supabase
    .from("technicians")
    .select("*")
    .order("created_at", { ascending: false });

  if (techniciansError) throw techniciansError;

  const technicianIds = (technicians ?? []).map((t) => t.id);
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, name, email")
    .in("id", technicianIds.length ? technicianIds : ["00000000-0000-0000-0000-000000000000"]);

  if (usersError) throw usersError;

  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  /**
   * Two facets, and they answer the two questions this screen is asked: "who is
   * still waiting to be approved" and "who is actually available right now". The
   * operational states are DERIVED by the database
   * (`refresh_technician_operational_status()`), never entered by hand, so a chip
   * here cannot drift from what the queue engine believes.
   */
  const rows: TechnicianRow[] = technicians ?? [];
  const facets: FacetSpec<TechnicianRow>[] = [
    {
      key: "approval",
      label: "Approval",
      values: ["approved", "pending_approval"],
      labels: { approved: "Approved", pending_approval: "Pending approval" },
      get: (technician) => (technician.approved ? "approved" : "pending_approval"),
    },
    {
      key: "availability",
      label: "Availability",
      values: OPERATIONAL_VALUES,
      labels: OPERATIONAL_LABELS,
      buckets: [
        {
          key: "unavailable",
          label: "Unavailable",
          values: ["TEMPORARILY_UNAVAILABLE", "OFFLINE", "SUSPENDED"],
        },
      ],
      get: (technician) => technician.operational_status,
    },
  ];

  const selected = resolveActive(facets, {
    approval: searchParams?.approval,
    availability: searchParams?.availability,
  });

  const groups = buildFacets(facets, rows, selected);

  /**
   * Free-text search, kept in the URL like the facets are.
   *
   * The facets answer "who is pending" and "who is available"; they cannot answer
   * "where is RoLLY". With a hundred technician accounts the list is a scroll, and
   * this page is where an admin arrives holding a name from a phone call. It is a
   * plain GET form rather than a client-side filter so the two narrowings compose,
   * the URL stays shareable, and the server-rendered `FilterDropdownLinks` above
   * keeps working exactly as it does (the facets travel as hidden inputs).
   */
  const search = (searchParams?.q ?? "").trim();
  const needle = search.toLowerCase();

  const visible = rows
    .filter((technician) => rowMatches(facets, technician, selected))
    .filter((technician) => {
      if (!needle) return true;
      const account = userMap.get(technician.id);
      return `${account?.name ?? ""} ${account?.email ?? ""}`.toLowerCase().includes(needle);
    });

  const narrowed = Boolean(search) || Object.values(selected).some((keys) => (keys?.length ?? 0) > 0);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-ink">Technicians</h1>

      {/* The only write this screen offers, and it is not a role change: it creates
          rows that a missing signup trigger would have left behind. See the note at
          the top of this file for why the promotion that used to live here is gone. */}
      <RepairTechnicianRecordsButton />

      {!rows.length ? (
        <p className="text-sm text-ink/70">No technician accounts yet.</p>
      ) : (
        <>
          <div className="mb-4 rounded-card border border-line bg-surface px-3 py-2.5 shadow-card">
            <FilterDropdownLinks
              groups={groups}
              selected={selected}
              basePath="/admin/technicians"
            />
          </div>

          {/* Search is a GET form so it works without JavaScript and composes with
              the facets above: `selected` travels as hidden inputs, so searching
              never silently drops the filters the admin already set. */}
          <form
            method="get"
            action="/admin/technicians"
            className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 shadow-card"
          >
            <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Search by name or email..."
              aria-label="Search technicians"
              className="min-w-[12rem] flex-1 bg-transparent text-sm text-ink placeholder:text-ink/50 outline-none"
            />
            {Object.entries(selected).flatMap(([key, values]) =>
              (values ?? []).map((value) => (
                <input key={`${key}:${value}`} type="hidden" name={key} value={value} />
              ))
            )}
            <button
              type="submit"
              className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition duration-200 hover:bg-soft"
            >
              Search
            </button>
            {narrowed && (
              <Link
                href="/admin/technicians"
                className="text-xs font-medium text-muted underline-offset-2 transition hover:text-ink hover:underline"
              >
                Clear
              </Link>
            )}
          </form>

          {!visible.length ? (
            <p className="text-sm text-ink/70">
              {search
                ? `No technician matches “${search}”.`
                : "No technicians match these filters."}
            </p>
          ) : (
            <div className="space-y-3">
              {visible.map((t) => {
                const u = userMap.get(t.id);
                return (
                  <div
                    key={t.id}
                    className="flex flex-col items-start gap-3 rounded-card border border-line p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{u?.name ?? "Unknown"}</p>
                        {/* The button below only says what pressing it will do, so
                            the row itself has to say what the account currently
                            is — otherwise "Revoke approval" is the only clue that
                            this technician is approved. */}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            t.approved
                              ? "bg-signal-soft text-signal-ink"
                              : "bg-warn-soft text-warn-ink"
                          }`}
                        >
                          {t.approved ? "Approved" : "Pending approval"}
                        </span>
                      </div>
                      <p className="break-all text-xs text-ink/70">{u?.email}</p>
                      <p className="mt-1 text-xs text-ink/70">
                        {t.experience_years} yrs experience · rating {t.rating.toFixed(1)}
                      </p>
                    </div>
                    <ApproveTechnicianButton technicianId={t.id} approved={t.approved} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

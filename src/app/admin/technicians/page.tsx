import { createServiceRoleClient } from "@/lib/supabase/server";
import ApproveTechnicianButton from "@/components/ApproveTechnicianButton";
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

  const { data: authUsers, error: authUsersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authUsersError) throw authUsersError;

  const technicianAuthUsers = authUsers.users.filter(
    (authUser) => authUser.user_metadata?.role === "technician" && authUser.email
  );
  for (const authUser of technicianAuthUsers) {
    const { data: profile } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", authUser.id)
      .maybeSingle();

    if (!profile) {
      await supabase.from("users").insert({
        id: authUser.id,
        name: String(authUser.user_metadata?.name ?? authUser.email?.split("@")[0]),
        email: authUser.email,
        role: "technician",
      });
    } else if (profile.role === "customer") {
      await supabase.from("users").update({ role: "technician" }).eq("id", authUser.id);
    }

    await supabase.from("technicians").upsert({ id: authUser.id }, { onConflict: "id" });
  }

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

  const visible = rows.filter((technician) => rowMatches(facets, technician, selected));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-ink">Technicians</h1>
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
          {!visible.length ? (
            <p className="text-sm text-ink/70">No technicians match these filters.</p>
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
                      <p className="font-medium text-ink">{u?.name ?? "Unknown"}</p>
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

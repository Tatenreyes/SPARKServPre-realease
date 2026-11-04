"use client";

import { useState } from "react";
import { Search, Star } from "lucide-react";
import FilterDropdowns from "@/components/FilterDropdown";
import { buildFacets, rowMatches, type FacetSpec, type FilterSelection } from "@/lib/filter-options";
import { ROLE_LABEL } from "@/lib/roleMeta";
import type { UserRow, UserRole } from "@/types/database";

/** The vocabulary, in the order `roleMeta` defines it; the bar sorts for display. */
const ROLE_ORDER: UserRole[] = ["customer", "technician", "admin", "super_admin"];

const ACCOUNT_VALUES = ["active", "inactive"] as const;
const ACCOUNT_LABEL: Record<string, string> = { active: "Active", inactive: "Inactive" };

const WORK_VALUES = ["on_job", "idle"] as const;
const WORK_LABEL: Record<string, string> = { on_job: "On a job", idle: "Idle" };

export default function UserManagementClient({
  initialUsers,
  busyUserIds = [],
  customerRatings = {},
}: {
  initialUsers: UserRow[];
  /**
   * Users holding at least one live booking, from the server page. "Active
   * account" and "on a job right now" are different questions, and an admin
   * dispatching work needs the second one; they are separate facets rather than
   * one overloaded "Active" chip.
   */
  busyUserIds?: string[];
  /**
   * What technicians have said about each customer (step 21), aggregated by the
   * server page: `{ average: 4.6, count: 3 }`. Absent means nobody has rated them,
   * which is NOT a score of zero — the rule the whole rating system follows.
   */
  customerRatings?: Record<string, { average: number | null; count: number }>;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterSelection>({});

  const busyIds = new Set(busyUserIds);

  const facets: FacetSpec<UserRow>[] = [
    {
      key: "role",
      label: "Role",
      values: ROLE_ORDER,
      labels: ROLE_LABEL,
      get: (user) => user.role,
    },
    {
      key: "account",
      label: "Account",
      values: ACCOUNT_VALUES,
      labels: ACCOUNT_LABEL,
      get: (user) => (user.is_active ? "active" : "inactive"),
    },
    {
      key: "work",
      label: "Work",
      values: WORK_VALUES,
      labels: WORK_LABEL,
      get: (user) => (busyIds.has(user.id) ? "on_job" : "idle"),
    },
  ];

  const groups = buildFacets(facets, users, filters);

  const filtered = users.filter(
    (u) =>
      rowMatches(facets, u, filters) &&
      (!search ||
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.role.toLowerCase().includes(search.toLowerCase()))
  );

  const narrowed = Object.values(filters).some((keys) => keys && keys.length > 0) || Boolean(search.trim());

  async function toggleStatus(user: UserRow) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      const json = await res.json();
      if (res.ok) {
        setUsers((prev) => prev.map((u) => (u.id === user.id ? json.data : u)));
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
          placeholder="Search users by name, email, or role..."
          className="w-full text-sm outline-none"
        />
      </div>

      <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2.5">
        <FilterDropdowns groups={groups} selected={filters} onChange={setFilters} />
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="min-w-[680px] w-full text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink/70">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink/70">
                  {narrowed ? "No users match these filters." : "No users found."}
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{u.name}</p>
                    <p className="text-xs text-ink/70">{u.email}</p>
                    {/* What technicians said about this customer, aggregated. A flag
                        for a human, never an automatic consequence — nothing in this
                        system suspends or refuses anybody on a score. */}
                    {(() => {
                      const summary = customerRatings[u.id];
                      if (!summary || summary.average == null || summary.count === 0) return null;
                      const flagged = summary.average < 3.5 && summary.count >= 3;
                      return (
                        <span
                          className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            flagged ? "bg-warn-soft text-warn-ink" : "bg-soft text-ink/70"
                          }`}
                        >
                          <Star className="h-3 w-3" aria-hidden="true" />
                          Tech rating {summary.average.toFixed(1)} · {summary.count}{" "}
                          {summary.count === 1 ? "visit" : "visits"}
                          {flagged ? " · review" : ""}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">
                      {ROLE_LABEL[u.role as UserRole] ?? u.role.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        u.is_active
                          ? "bg-signal-soft text-signal-ink"
                          : "bg-alert-soft text-alert-ink"
                      }`}
                    >
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink/70">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleStatus(u)}
                      disabled={busyId === u.id}
                      className="text-xs font-semibold text-brand-ink hover:underline disabled:opacity-50"
                    >
                      {busyId === u.id ? "..." : u.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

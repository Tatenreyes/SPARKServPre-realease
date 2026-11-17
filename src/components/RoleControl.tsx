"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/types/database";

const ROLES: UserRole[] = ["customer", "technician", "admin", "super_admin"];

/**
 * The role dropdown on `/superadmin/admins`.
 *
 * WHY IT REPORTS ITS OWN FAILURES. It used to fire the PATCH, ignore the answer and
 * refresh, so a refused change left the dropdown showing a role the database had never
 * accepted — with nothing said about why. Every refusal has a reason a super
 * administrator needs:
 *
 *   * **400** — the role is not one of the four (a stale tab, or a hand-made request), or
 *     the database refused the change by one of its own rules, whose words are passed
 *     through: changing your **own** role away from `super_admin`, or removing the last
 *     **active** super administrator;
 *   * **401 / 403** — the session is not a super administrator any more;
 *   * **503 `SERVICE_SETUP_REQUIRED`** — this database has not had
 *     `supabase/migration_set_user_role.sql` applied, so `set_user_role()` does not exist
 *     and the change cannot be made transactionally yet.
 *
 * On any of them the selection snaps back to the role the database still has, so the
 * control can never claim a change that did not happen.
 */
export default function RoleControl({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: UserRole;
}) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(newRole: UserRole) {
    setRole(newRole);
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        setRole(currentRole);
        setError(await failureMessage(response));
        return;
      }

      router.refresh();
    } catch {
      setRole(currentRole);
      setError("The role could not be changed — the request did not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <select
        value={role}
        disabled={saving}
        aria-label="Role"
        aria-busy={saving}
        onChange={(e) => handleChange(e.target.value as UserRole)}
        className="rounded-lg border border-line px-2 py-1.5 text-sm"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r.replace("_", " ")}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="max-w-xs text-xs leading-relaxed text-alert-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The API's own words, with the one status that needs an instruction rather than a
 * sentence. A body that is not JSON (a proxy error page, an empty 500) must not be the
 * thing that decides what the administrator sees, so the status is the fallback.
 */
async function failureMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const reported =
    typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;

  if (response.status === 503 || body?.code === "SERVICE_SETUP_REQUIRED") {
    return (
      reported ??
      "This database is missing the transactional role change. Apply supabase/migration_set_user_role.sql, then try again."
    );
  }

  return reported ?? `The role could not be changed (HTTP ${response.status}).`;
}

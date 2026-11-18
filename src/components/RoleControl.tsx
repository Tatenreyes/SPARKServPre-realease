"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL } from "@/lib/roleMeta";
import type { UserRole } from "@/types/database";

const ROLES: UserRole[] = ["customer", "technician", "admin", "super_admin"];

export default function RoleControl({
  userId,
  accountName,
  currentRole,
}: {
  userId: string;
  accountName: string;
  currentRole: UserRole;
}) {
  const router = useRouter();
  const [savedRole, setSavedRole] = useState(currentRole);
  const [draftRole, setDraftRole] = useState<UserRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveRole() {
    if (!draftRole || saving) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: draftRole }),
      });

      if (!response.ok) {
        setDraftRole(null);
        setError(await failureMessage(response));
        return;
      }

      setSavedRole(draftRole);
      setDraftRole(null);
      router.refresh();
    } catch {
      setDraftRole(null);
      setError("Could not confirm the role change. Check the current role before trying again.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-2" aria-busy={saving}>
      <select
        value={draftRole ?? savedRole}
        disabled={saving}
        aria-label={`Role for ${accountName}`}
        onChange={(event) => {
          const nextRole = event.target.value as UserRole;
          setDraftRole(nextRole === savedRole ? null : nextRole);
          setError(null);
        }}
        className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink sm:min-h-9"
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>{ROLE_LABEL[role]}</option>
        ))}
      </select>
      {draftRole && (
        <div className="max-w-xs rounded-lg border border-line bg-soft p-3">
          <p className="break-words text-sm text-ink">
            Change <strong>{accountName}</strong> from {ROLE_LABEL[savedRole]} to {ROLE_LABEL[draftRole]}?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveRole}
              disabled={saving}
              className="min-h-11 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 sm:min-h-9"
            >
              {saving ? "Saving..." : "Save role"}
            </button>
            <button
              type="button"
              onClick={() => setDraftRole(null)}
              disabled={saving}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-brand-soft disabled:opacity-60 sm:min-h-9"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Repair the technician rows a missing signup trigger would have left behind.
 *
 * WHY A BUTTON AND NOT A SIDE EFFECT. This screen used to run the repair while it
 * rendered, and it decided who to promote from `user_metadata.role` — a field the
 * account holder can write. That made a page view a role-granting action: any customer
 * could set their own metadata to `technician` and be promoted the next time an
 * administrator opened this page, with the service role bypassing the
 * `prevent_role_change()` trigger that refuses exactly that. The repair is now a click,
 * inside a request, attributed to the administrator who made it — and the endpoint
 * behind it only ever creates missing rows, so it cannot promote anybody.
 *
 * The counts it reports are the honest answer to "did anything need doing", which is
 * why the empty case says so in words rather than showing a silent zero.
 */
export default function RepairTechnicianRecordsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function repair() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/technicians/repair", { method: "POST" });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? "The repair could not be completed.");
        return;
      }

      const profiles = body?.data?.profiles_created ?? 0;
      const rows = body?.data?.technician_rows_created ?? 0;
      const parked = body?.data?.inactive_not_repaired ?? 0;

      if (profiles + rows === 0) {
        setResult(
          parked
            ? "Nothing to repair. A closed account is missing its technician record; reopening it is a separate decision."
            : "Nothing to repair — every technician account already has its records."
        );
      } else {
        setResult(
          `Created ${profiles} profile${profiles === 1 ? "" : "s"} and ${rows} technician ` +
            `record${rows === 1 ? "" : "s"}. Approve anyone who should start receiving work.`
        );
      }

      router.refresh();
    } catch {
      setError("The repair could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-surface px-3 py-2.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink">Missing technician records</p>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/70">
            Creates the profile and technician record for accounts that signed up as a technician
            before the signup trigger existed. It never changes an existing role — an account that
            is already a customer stays a customer, whatever its signup metadata says.
          </p>
        </div>
        <button
          type="button"
          onClick={repair}
          disabled={loading}
          className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition duration-200 hover:bg-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Repairing..." : "Repair records"}
        </button>
      </div>
      {result && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-signal-ink">
          {result}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-alert-ink">
          {error}
        </p>
      )}
    </div>
  );
}

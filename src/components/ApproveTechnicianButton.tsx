"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Approve, or revoke an approval.
 *
 * Revoking is NOT a delete, and the button used to look exactly like one: one
 * click, no explanation, sitting where a destructive action sits. It flips
 * `technicians.approved` back to false, which removes the technician from queue
 * eligibility — the account, its job history, its ratings and its queue rows all
 * stay exactly where they are, and approving again restores them.
 *
 * So revoking now takes two steps and says that in words. Approving stays one
 * click: it is reversible, and it is the action that unblocks somebody who is
 * waiting to work.
 */
export default function ApproveTechnicianButton({
  technicianId,
  approved,
}: {
  technicianId: string;
  approved: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      await fetch(`/api/technicians/${technicianId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: !approved }),
      });
      router.refresh();
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  if (approved && confirming) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="max-w-xs text-xs leading-relaxed text-ink/70">
          Revoke approval? The account and its history are kept. They just stop receiving new
          jobs, and you can approve them again at any time.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            disabled={loading}
            className="cursor-pointer rounded-lg bg-alert-500 px-3 py-1.5 text-xs font-semibold text-white transition duration-200 hover:bg-alert-600 disabled:opacity-50"
          >
            {loading ? "Revoking..." : "Yes, revoke"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink/80 transition duration-200 hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => (approved ? setConfirming(true) : toggle())}
      disabled={loading}
      className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        approved
          ? "border border-line text-ink/80 hover:bg-canvas"
          : "bg-brand-500 text-white hover:bg-brand-600"
      }`}
    >
      {loading ? "Saving..." : approved ? "Revoke approval" : "Approve"}
    </button>
  );
}

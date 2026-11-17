"use client";

import { useId, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_HINT,
  validateNewPassword,
} from "@/lib/password";

/**
 * Changing your own password from Settings, on an ordinary signed-in session.
 *
 * Deliberately NOT the recovery form (`UpdatePasswordForm`). That one lives
 * behind a one-use recovery session, asks no old password because the link is the
 * proof, and SIGNS THE USER OUT when it finishes so the authorization cannot be
 * replayed. None of that applies here: this card is reached from a normal
 * session, so the session is kept — a technician changing their password between
 * jobs must not be thrown back to the login screen.
 *
 * The password rule is the app's single rule (`src/lib/password.ts`: length
 * bounds, the hint under the field, and `validateNewPassword`). The recovery
 * module's *messages* are not reused: they talk about reset links, which would be
 * nonsense on this screen, so the few Supabase error codes that matter are
 * translated here instead.
 */
const FIELD =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 pr-11 text-sm text-ink placeholder:text-ink/50 outline-none transition-colors duration-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15";

type SupabaseUpdateError = {
  code?: string | null;
  message?: string | null;
  status?: number;
  name?: string;
};

function describeUpdateError(error: unknown): string {
  const failure = (error ?? {}) as SupabaseUpdateError;
  const code = failure.code ?? "";
  const message = (failure.message ?? "").toLowerCase();

  if (code === "same_password") {
    return "That is already your current password. Choose a different one.";
  }

  if (code === "weak_password" || failure.status === 422) {
    return "That password was rejected by the password policy. Try a longer, less predictable one.";
  }

  if (
    code === "session_not_found" ||
    code === "session_expired" ||
    failure.name === "AuthSessionMissingError" ||
    message.includes("auth session missing")
  ) {
    return "Your session has ended. Sign in again, then change your password.";
  }

  if (message.includes("failed to fetch") || message.includes("network")) {
    return "We could not reach the server. Check your connection and try again.";
  }

  return "We couldn't update your password just now. Please try again.";
}

export default function ChangePasswordCard({ email }: { email: string }) {
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const passwordId = useId();
  const confirmationId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);

    const check = validateNewPassword(password, confirmation);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    if (saving) return;
    setSaving(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(describeUpdateError(updateError));
        return;
      }

      // The session is intentionally left alone: the password changed, the
      // person is still signed in on this device.
      setPassword("");
      setConfirmation("");
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:p-5">
      <h2 className="font-display text-[15px] font-semibold text-ink">Sign-in and password</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        You stay signed in on this device after changing your password.
      </p>

      <dl className="mt-3 rounded-xl border border-line bg-soft px-3.5 py-2.5">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Sign-in email
        </dt>
        <dd className="mt-0.5 break-all text-sm text-ink/80">{email}</dd>
      </dl>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={passwordId} className="flex items-center gap-2 text-sm font-semibold text-ink/80">
            <KeyRound className="h-4 w-4 text-muted" aria-hidden="true" />
            New password
          </label>
          <div className="relative">
            <input
              id={passwordId}
              required
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter a new password"
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide new password" : "Show new password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted">{PASSWORD_HINT}</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={confirmationId} className="flex items-center gap-2 text-sm font-semibold text-ink/80">
            <KeyRound className="h-4 w-4 text-muted" aria-hidden="true" />
            Confirm new password
          </label>
          <div className="relative">
            <input
              id={confirmationId}
              required
              type={showConfirmation ? "text" : "password"}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="Repeat the new password"
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setShowConfirmation((value) => !value)}
              aria-label={showConfirmation ? "Hide confirmation" : "Show confirmation"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink"
            >
              {showConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert-ink">
            {error}
          </p>
        )}
        {done && (
          <p className="flex items-center gap-2 rounded-lg bg-signal-soft px-3 py-2 text-sm text-signal-ink">
            <Check className="h-4 w-4" aria-hidden="true" />
            Password updated. You are still signed in.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-[#81EDF4]"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {saving ? "Saving..." : "Update password"}
        </button>
      </form>

    </section>
  );
}

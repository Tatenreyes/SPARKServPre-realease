import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { ArrowRight, LogIn, UserPlus } from "lucide-react";

interface ChooseAuthPageProps {
  searchParams: { redirectTo?: string };
}

export default function ChooseAuthPage({ searchParams }: ChooseAuthPageProps) {
  const redirectTo = searchParams.redirectTo || "/customer/request-repair";
  const query = `?redirectTo=${encodeURIComponent(redirectTo)}`;

  return (
    <AuthShell
      headline="Request a repair"
      subhead="Use your account to submit a repair request, review your estimate, and track updates."
    >
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-7 shadow-card">
        <h1 className="font-display text-2xl font-semibold text-ink">Sign in or create an account to request a repair</h1>
        <div className="mt-7 space-y-3">
          <Link href={`/login${query}`} className="flex items-center justify-between rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
            <span className="flex items-center gap-3"><LogIn className="h-4 w-4" /> Sign in</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href={`/register${query}`} className="flex items-center justify-between rounded-lg border border-line bg-brand-soft px-4 py-3 text-sm font-semibold text-brand-ink transition hover:border-brand-400">
            <span className="flex items-center gap-3"><UserPlus className="h-4 w-4" /> Create a customer account</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <Link href="/" className="mt-6 block text-center text-xs font-semibold text-muted hover:text-brand-ink">Return home</Link>
      </div>
    </AuthShell>
  );
}

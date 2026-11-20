import Link from "next/link";
import { ChevronRight } from "lucide-react";
import RequestRepairWizard from "@/components/RequestRepairWizard";

export const dynamic = "force-dynamic";

export default function RequestMaintenancePage() {
  return (
    <div className="space-y-3">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <Link href="/customer/dashboard" className="transition-colors hover:text-ink">Dashboard</Link>
        <ChevronRight className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
        <span className="font-medium text-ink/70">Maintenance</span>
      </nav>
      <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Cleaning and Preventive Maintenance</h1>
      <p className="mt-1 text-sm text-ink/70">Request cleaning and preventive maintenance for your appliance.</p>
      <div className="mt-6">
        <RequestRepairWizard requestKind="maintenance" />
      </div>
    </div>
  );
}

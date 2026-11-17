import Link from "next/link";
import { Clock, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import AppearanceCard from "@/components/AppearanceCard";
import ChangePasswordCard from "@/components/ChangePasswordCard";
import PushSettingsCard from "@/components/PushSettingsCard";
import MobileSectionLinks from "@/components/mobile/MobileSectionLinks";
import SignOutRow from "@/components/mobile/SignOutRow";

/**
 * The technician's own settings.
 *
 * Account-level things only, and deliberately so: who they are and where they work
 * live elsewhere — the profile at `/technician/profile` (name, photo,
 * specialisations) and the work windows at `/technician/availability` (hours, time
 * off, areas), which are the three tables the queue actually evaluates. Copying
 * those forms here would be two places to drift, so this page owns the three
 * things a profile page should not — how the app looks, the password, and whether
 * this browser receives push.
 *
 * The only way in is the topbar avatar menu, through `ROLE_SETTINGS_HREF`: this
 * route is deliberately absent from the sidebar and the bottom bar, so the
 * technician's navigation lists work, not account plumbing.
 */
export default async function TechnicianSettingsPage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink">
          Account
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Settings</h1>
        <p className="mt-2 text-sm text-muted">
          How SPARKServ looks and behaves on this device. Your profile and your availability live
          on their own screens.
        </p>
      </div>

      <AppearanceCard />

      <ChangePasswordCard email={user.email} />

      <PushSettingsCard />

      <MobileSectionLinks
        title="Work details"
        description="Your profile and your availability are separate screens."
        links={[
          {
            href: "/technician/profile",
            label: "Profile & specialisations",
            hint: "Name, photo, years of experience and the appliances you service",
            icon: UserRound,
          },
          {
            href: "/technician/availability",
            label: "Availability",
            hint: "Weekly working hours, time off and service areas",
            icon: Clock,
          },
        ]}
      />

      {/* A card row with one row of two and one lone cell draws a divider beside
          nothing, so the policies link stays a link. It is still the only route to
          that page from the technician workspace. */}
      <p className="text-xs leading-relaxed text-muted">
        <Link
          href="/policies/technician"
          className="font-semibold text-brand-ink underline-offset-2 hover:underline"
        >
          Technician policies
        </Link>{" "}
        — what the rotation expects from you, and what you can expect from it.
      </p>

      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(16,38,74,0.04)]">
        <SignOutRow />
      </section>
    </div>
  );
}

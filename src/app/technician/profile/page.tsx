import ProfileForm from "@/components/ProfileForm";

/**
 * The technician's profile: the name, photo and specialisations customers and the
 * rotation see.
 *
 * Availability moved to `/technician/availability` (the sidebar item), so this
 * page answers "who are you" and nothing else. It is reached from the topbar
 * avatar menu — its "Profile" entry — rather than a sidebar item, which is also
 * why the form is the whole page.
 */
export default function TechnicianProfilePage() {
  return (
    <div className="space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink">Account</p><h1 className="mt-2 font-display text-3xl font-semibold text-ink">My profile</h1><p className="mt-2 text-sm text-muted">Show customers what you do and how they can reach you.</p></div>
      <ProfileForm role="technician" />
    </div>
  );
}

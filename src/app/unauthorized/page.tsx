import Link from "next/link";

/**
 * Where an account that may not enter a section is sent.
 *
 * `?reason=inactive` distinguishes the two cases the middleware refuses: an
 * account with the wrong role, and an account an administrator has DEACTIVATED.
 * They need different words — "you don't have access" is wrong for somebody whose
 * own account was closed, and the earlier generic copy left a deactivated
 * customer with no idea what had happened (before the middleware checked at all,
 * they got a crash instead).
 */
export default function UnauthorizedPage({
  searchParams,
}: {
  searchParams?: { reason?: string };
}) {
  const deactivated = searchParams?.reason === "inactive";

  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold text-ink">
        {deactivated ? "Account deactivated" : "Not authorized"}
      </h1>
      <p className="mt-2 text-ink/70">
        {deactivated
          ? "Your SPARKServ account has been deactivated, so this section is closed. Contact SPARKServ support if you think this is a mistake, an administrator can restore access."
          : "Your account doesn't have access to that section of SPARKServ."}
      </p>
      <Link href="/" className="mt-6 inline-block text-brand-ink hover:underline">
        Back to home
      </Link>
    </div>
  );
}

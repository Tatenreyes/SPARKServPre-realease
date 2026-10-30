import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline — SPARKServ" };

/**
 * The page the service worker serves when a navigation cannot reach the network.
 *
 * Static on purpose: it is shown precisely when nothing can be fetched, so it must
 * render without data, without a session and without a query.
 *
 * The copy states the consequence rather than soothing it. A repair request, an
 * accepted offer and a verified payment all become real when the server records
 * them; a half-finished submission that never left the browser is not a queued job,
 * and telling a customer otherwise would be the kind of false reassurance this
 * project spends its effort avoiding.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-soft text-muted">
        <WifiOff className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-xl font-bold text-ink">You are offline</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        SPARKServ needs a connection. A request only counts once the server has recorded
        it, so if you were submitting something when the connection dropped, please send
        it again when you are back online.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-brand-500 px-5 text-sm font-semibold text-white transition duration-200 hover:bg-brand-600"
      >
        Try again
      </Link>
    </div>
  );
}

import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

const FOOTER_LINKS = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export default function Footer({ variant = "default" }: { variant?: "default" | "landing" }) {
  const isLanding = variant === "landing";
  const accent = isLanding ? "text-brand-600 dark:text-[#81EDF4]" : "text-brand-ink";
  return (
    <footer className="border-t border-line bg-canvas text-ink">
      <div className="spark-section py-9 md:py-11">
        <div className="grid gap-8 md:grid-cols-[1.5fr_1fr_1.1fr]">
          <div>
            <Link href="/" aria-label="SPARKServ home" className="flex items-center gap-2.5">
              <BrandLogo size={36} />
                <span className="font-display text-lg font-bold tracking-tight text-ink">
                SPARK<span className={accent}>Serv</span>
              </span>
            </Link>
            <p className={`mt-2 text-[11px] font-bold uppercase tracking-[0.16em] ${accent}`}>
              Appliance Repair &amp; Service
            </p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted">
              Connecting customers to verified technicians, transparent estimates, and repair
              tracking in Cagayan de Oro City.
            </p>
          </div>

          <nav aria-label="Footer navigation">
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${accent}`}>Explore</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-muted">
              {FOOTER_LINKS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="transition-colors duration-200 hover:text-ink">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${accent}`}>Contact</p>
            <ul className="mt-3 space-y-2.5 text-sm text-muted">
              <li>
                <a href="tel:+639123456789" className="inline-flex items-center gap-2 transition-colors duration-200 hover:text-ink">
                  <Phone className={`h-3.5 w-3.5 ${accent}`} />
                  +63 912 345 6789
                </a>
              </li>
              <li>
                <a href="mailto:support@sparkserv.com" className="inline-flex items-center gap-2 transition-colors duration-200 hover:text-ink">
                  <Mail className={`h-3.5 w-3.5 ${accent}`} />
                  support@sparkserv.com
                </a>
              </li>
              <li className="inline-flex items-center gap-2">
                <MapPin className={`h-3.5 w-3.5 ${accent}`} />
                Cagayan de Oro City
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-line pt-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 SPARKServ. All rights reserved.</span>
          <span className="flex gap-4">
            <Link href="/policies/privacy" className="transition-colors duration-200 hover:text-ink">
              Privacy Policy
            </Link>
            <Link href="/policies/terms" className="transition-colors duration-200 hover:text-ink">
              Terms of Service
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}


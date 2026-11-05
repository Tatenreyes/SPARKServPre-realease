import { IconChat, IconScale, IconShieldCheck } from "@/components/icons";
import Image from "next/image";
import BrandLogo from "@/components/BrandLogo";

interface AuthShellProps {
  headline: string;
  subhead: string;
  children: React.ReactNode;
  backgroundImage?: string;
  backgroundImageAlt?: string;
  backgroundImageFit?: "cover" | "contain";
  backgroundImageScrim?: boolean;
  backgroundCopyPanel?: boolean;
  panelStyle?: "default" | "signup";
}

/**
 * Split auth layout: a photographic panel beside the form.
 *
 * Both props are required and both are rendered. An earlier revision declared
 * `headline` / `subhead` in the props interface but destructured only
 * `children`, so the copy passed by `/login`, `/register` and `/choose` was
 * silently dropped and every auth page showed the same hardcoded login line, * the register page read "Good to see you again" to someone signing up.
 *
 * The selected auth photo stays visible on the right and fades into the surface
 * behind the copy, keeping the subject clear while the text stays readable.
 *
 * Height is `100vh - 88px`, not `- 80px`: the marketing navbar is `py-3` (24px)
 * around a `h-16` (64px) card, so subtracting 80px left an 8px overflow and put
 * a stray scrollbar on every auth page.
 */
export default function AuthShell({
  headline,
  subhead,
  children,
  backgroundImage = "/images/TECH2.jpg",
  backgroundImageAlt = "SPARKServ technician holding repair tools",
  backgroundImageFit = "cover",
  backgroundImageScrim = true,
  backgroundCopyPanel = false,
  panelStyle = "default",
}: AuthShellProps) {
  return (
    <div
      className={`reference-palette grid min-h-[calc(100vh-88px)] md:grid-cols-[1.05fr_1fr] ${
        panelStyle === "signup" ? "auth-signup-shell" : "bg-canvas"
      }`}
    >
      <div
        className={`relative hidden min-h-full overflow-hidden md:flex ${
          panelStyle === "signup" ? "auth-signup-stage" : "bg-[#0d6f9f]"
        } ${
          panelStyle !== "signup" && backgroundImageFit === "contain"
            ? "bg-[radial-gradient(circle_at_85%_45%,_#1684b7_0%,_#0d5379_42%,_#071a2a_100%)]"
            : ""
        }`}
      >
        <Image
          src={backgroundImage}
          alt={backgroundImageAlt}
          fill
          priority
          quality={100}
          sizes="(max-width: 1024px) 50vw, 55vw"
          className={`${backgroundImageFit === "contain" ? "object-contain object-right" : "object-cover object-[35%_center]"}`}
        />
        {backgroundImageScrim && <div aria-hidden="true" className="auth-photo-scrim absolute inset-0" />}
        <div
          className={`relative z-10 flex max-w-md flex-col justify-center ${
            backgroundCopyPanel
              ? "mx-6 rounded-2xl bg-surface/90 px-7 py-8 backdrop-blur-sm"
              : "px-10 py-16 lg:px-14"
          }`}
        >
          <div
            className={
              panelStyle === "signup"
                ? "w-fit max-w-full rounded-xl bg-[#071725]/80 px-3 py-2.5 backdrop-blur-sm"
                : ""
            }
          >
            <h1 className={`font-display text-4xl font-bold leading-tight ${panelStyle === "signup" ? "text-white" : "text-ink"}`}>
              {headline}
            </h1>
            <p className={`mt-2 max-w-xs text-base leading-7 ${panelStyle === "signup" ? "text-white" : "text-muted"}`}>
              {subhead}
            </p>
          </div>
          <div className="mt-8 space-y-5">
            <Badge
              icon={<IconShieldCheck className="h-5 w-5" />}
              compact={panelStyle === "signup"}
              label="Repair support in one place"
              detail="Submit a request, review estimates, and follow its progress."
            />
            <Badge
              icon={<IconChat className="h-5 w-5" />}
              compact={panelStyle === "signup"}
              label="Clear service updates"
              detail="See the current status of your repair as it moves forward."
            />
            <Badge
              icon={<IconScale className="h-5 w-5" />}
              compact={panelStyle === "signup"}
              label="Estimates before booking"
              detail="Review the proposed work and cost before confirming a visit."
            />
          </div>
        </div>
      </div>

      <div
        className={`flex items-center justify-center px-5 md:px-8 lg:px-12 ${
          panelStyle === "signup" ? "py-4 sm:py-6 md:py-8" : "py-10 sm:py-14 md:py-12"
        }`}
      >
        <div className="w-full max-w-[480px]">
          <div className="mb-6 md:hidden">
            <BrandLogo size={38} variant="auto" />
            <h1 className="mt-5 font-display text-2xl font-bold leading-tight text-ink">{headline}</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{subhead}</p>
          </div>
          <div
            className={
              panelStyle === "signup"
                ? "auth-signup-form-panel dark text-ink w-full max-w-[480px] p-0"
                : "rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8"
            }
          >
            {panelStyle === "signup" && (
              <div className="mb-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                SPARKServ account
              </div>
            )}
            {children}
          </div>
          <p className="mt-5 text-center text-xs leading-5 text-muted">
            Need help with your account? <a className="font-semibold text-brand-ink underline-offset-4 hover:underline" href="mailto:support@sparkserv.com">Contact support</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function Badge({
  icon,
  label,
  detail,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 text-sm ${compact ? "rounded-xl bg-[#071725]/80 px-3 py-2.5 backdrop-blur-sm" : ""}`}>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft ring-1 ring-line ${compact ? "text-white" : "text-brand-ink"}`}>
        {icon}
      </span>
      <span>
        <strong className={`block font-semibold ${compact ? "text-white" : "text-ink"}`}>{label}</strong>
        {detail && <small className={`mt-1 block max-w-[190px] leading-5 ${compact ? "text-white" : "text-muted"}`}>{detail}</small>}
      </span>
    </div>
  );
}

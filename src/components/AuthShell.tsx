import Image from "next/image";

interface AuthShellProps {
  headline: string;
  subhead: string;
  photo?: string;
  children: React.ReactNode;
}

export default function AuthShell({
  headline,
  subhead,
  photo = "/images/C1-Featured-Image-Tech-working-on-a-fridge_-1.jpg",
  children,
}: AuthShellProps) {
  return (
    <main className="reference-palette grid min-h-[calc(100dvh-4rem)] bg-canvas lg:grid-cols-2">
      <div className="relative isolate hidden items-end overflow-hidden bg-[#071725] lg:flex">
        <Image
          src={photo}
          alt=""
          fill
          priority
          sizes="50vw"
          className="-z-20 object-cover object-center"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-[#071725] via-[#071725]/45 to-transparent"
        />
        <div className="max-w-lg px-8 pb-12 lg:px-14 lg:pb-16">
          <p className="font-display text-4xl font-bold leading-tight text-white">{headline}</p>
          <p className="mt-3 max-w-sm text-base leading-7 text-white/90">{subhead}</p>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-8 md:px-8 lg:px-12">
        <div className="w-full max-w-[480px]">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
            {children}
          </div>
          <p className="mt-5 text-center text-xs leading-5 text-muted">
            Need help with your account?{" "}
            <a
              className="font-semibold text-brand-ink underline-offset-4 hover:underline"
              href="mailto:support@sparkserv.com"
            >
              Contact support
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

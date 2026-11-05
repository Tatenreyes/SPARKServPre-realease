"use client";

export default function LoginLoadingScreen({ message = "Logging in..." }: { message?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-[2px]"
    >
      <div className="flex w-56 flex-col items-center gap-4 rounded-2xl border border-line bg-surface px-6 py-8 shadow-xl">
        <div className="relative h-28 w-28">
          <div className="absolute inset-0 rounded-full border-[3px] border-ink/10" />
          <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-brand-500" />
          <div className="absolute inset-0 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo/sparkserv-icon-light.png"
              alt=""
              className="h-16 w-16 animate-pulse dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo/sparkserv-icon-dark.png"
              alt=""
              className="hidden h-16 w-16 animate-pulse dark:block"
            />
          </div>
        </div>
        <p className="text-sm font-semibold text-ink">{message}</p>
      </div>
    </div>
  );
}
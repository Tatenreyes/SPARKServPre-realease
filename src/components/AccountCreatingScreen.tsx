"use client";

import { useEffect, useState } from "react";

type Mode = "login" | "register";

const CONTENT: Record<
  Mode,
  { steps: string[]; title: string; sub: string; doneTitle: string; interval: number }
> = {
  register: {
    steps: [
      "Creating your account",
      "Setting up your profile",
      "Securing your data",
      "Almost ready",
    ],
    title: "Creating your account...",
    sub: "This only takes a few seconds. Keep this page open.",
    doneTitle: "Account created",
    interval: 1250,
  },
  login: {
    steps: ["Checking your details", "Signing you in", "Loading your dashboard"],
    title: "Signing you in...",
    sub: "Hang tight, we're getting your dashboard ready.",
    doneTitle: "Welcome back",
    interval: 700,
  },
};

type Props = {
  mode: Mode;
  /** true once the request succeeded: shows the success state */
  done?: boolean;
};

export default function AccountCreatingScreen({ mode, done = false }: Props) {
  const c = CONTENT[mode];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setStep((s) => Math.min(s + 1, c.steps.length - 1)),
      c.interval
    );
    return () => clearInterval(t);
  }, [c.steps.length, c.interval]);

  const pct = done ? 100 : Math.round(((step + 1) / (c.steps.length + 1)) * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface/95 px-4 backdrop-blur-sm"
    >
      <div className="relative mb-6 h-32 w-32">
        <div className="absolute inset-0 rounded-full border-[3px] border-ink/10" />
        {done ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full border-[3px] border-emerald-500">
            <svg
              viewBox="0 0 24 24"
              className="h-14 w-14 text-emerald-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
        ) : (
          <>
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-brand-500" />
            <div className="absolute inset-0 flex items-center justify-center">
              {/* copy the logo icons to public/logo/ */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo/sparkserv-icon-light.png"
                alt=""
                className="h-20 w-20 animate-pulse dark:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo/sparkserv-icon-dark.png"
                alt=""
                className="hidden h-20 w-20 animate-pulse dark:block"
              />
            </div>
          </>
        )}
      </div>

      <h2 className="mb-1 font-display text-lg font-bold text-ink">
        {done ? c.doneTitle : c.title}
      </h2>
      <p className="mb-6 text-center text-sm text-ink/70">
        {done ? "Taking you to your dashboard..." : c.sub}
      </p>

      <ul className="mb-5 w-64 space-y-1">
        {c.steps.map((label, i) => {
          const complete = done || i < step;
          const current = !done && i === step;
          return (
            <li
              key={label}
              className={`flex h-7 items-center gap-2.5 text-sm ${
                current ? "text-ink" : complete ? "text-ink/70" : "text-ink/40"
              }`}
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center">
                {complete ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 text-emerald-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : current ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-ink/25" />
                )}
              </span>
              {label}
            </li>
          );
        })}
      </ul>

      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-brand-600 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
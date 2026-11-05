"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * The only control for the stored theme choice, so it is the one place the
 * `dark` class, `color-scheme` and the `sparkserv-theme` key are driven from.
 *
 * `resolved` is deliberately "light" on the server and on the first client
 * render, because the provider reads nothing browser-only while rendering. The
 * icon therefore settles on the real theme one paint after mount instead of
 * risking a hydration mismatch. Size comes from the caller so it lines up with
 * whichever header it sits in.
 */
export default function ThemeToggle({ className = "h-10 w-10" }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to the light theme" : "Switch to the dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-line text-muted transition-colors duration-200 hover:border-ink/40 hover:bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:focus-visible:ring-[#81EDF4] ${className}`}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

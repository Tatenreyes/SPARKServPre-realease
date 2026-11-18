"use client";

import { useEffect, useState } from "react";
import { Check, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme, type Theme } from "@/components/ThemeProvider";

/**
 * The stored theme choice, spelled out.
 *
 * The app has exactly two themes (`src/lib/theme.ts`: `Theme = "light" | "dark"`)
 * and a sun/moon icon already lives in the topbar (`ThemeToggle`), but an icon
 * does not tell you what it will do and "Settings" is where people look for this.
 * So this is the same choice in words.
 *
 * `theme` is `null` until the provider mounts, and the painted default is DARK
 * (the pre-paint script in `src/app/layout.tsx`). Reading it during render would
 * therefore highlight nothing on the first paint while the page is already dark,
 * so nothing is marked as selected until after mount — the same compromise
 * `ThemeToggle` makes with its icon, made explicit here because a radio group
 * with nothing checked reads as broken.
 *
 * Both controls write through `ThemeProvider.setTheme`, so the topbar toggle and
 * this card cannot drift apart, and the choice persists in `localStorage` under
 * the existing `sparkserv-theme` key (no new storage, no server round-trip).
 */
const OPTIONS: { value: Theme; label: string; hint: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", hint: "Bright background, dark text.", Icon: Sun },
  { value: "dark", label: "Dark", hint: "Dark background, easier at night.", Icon: Moon },
];

export default function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const selected: Theme | null = mounted ? theme : null;

  /**
   * A radiogroup is expected to respond to the arrow keys. There are two options,
   * so an arrow simply selects the other one; focus stays on the tile the reader
   * is already on, and the `aria-checked` state follows the theme.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    setTheme((selected ?? (theme ?? "dark")) === "dark" ? "light" : "dark");
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:p-5">
      <h2 className="font-display text-[15px] font-semibold text-ink">Appearance</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        Choose how SPARKServ looks on this device. Dark is the default, and the choice is
        remembered in this browser only.
      </p>

      <div
        role="radiogroup"
        aria-label="Colour theme"
        onKeyDown={handleKeyDown}
        className="mt-3 grid grid-cols-2 gap-3"
      >
        {OPTIONS.map(({ value, label, hint, Icon }) => {
          const isSelected = selected === value;

          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setTheme(value)}
              className={`flex min-h-[76px] flex-col items-start rounded-xl border p-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:focus-visible:ring-[#81EDF4] ${
                isSelected
                  ? "border-brand-600 bg-brand-soft"
                  : "border-line bg-surface hover:border-brand-300 hover:bg-soft"
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                    isSelected ? "border-brand-600 text-brand-ink" : "border-line text-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {isSelected && (
                  <Check className="h-4 w-4 text-brand-ink" aria-hidden="true" />
                )}
              </span>
              <span className="mt-1.5 block text-sm font-semibold text-ink">{label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>
            </button>
          );
        })}
      </div>

      {/* Server and first client render agree on this sentence, so the switch
          never flashes the wrong state before the provider has mounted. */}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {selected === null
          ? "Dark is the default for this device."
          : `You are using the ${selected} theme.`}
      </p>
    </section>
  );
}

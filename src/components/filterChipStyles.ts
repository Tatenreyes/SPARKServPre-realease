/**
 * The filter control's styles, in a module that is NOT `"use client"`.
 *
 * WHY IT LIVES APART. `FilterDropdown` is a client component, and every export of
 * a client module becomes a client reference when a server component imports it —
 * so a plain style helper exported from there could not be CALLED by the
 * technician-queue page, which renders its chips on the server. Keeping the class
 * strings here means one definition of what a filter control looks like, reachable
 * from both worlds, and the queue page's chips can no longer drift from the
 * dropdowns in the client lists.
 *
 * The classes satisfy `npm run test:design`: no `text-white` on a surface fill, no
 * fixed `-50` tint, no text below the contrast floor, and no state variant that
 * repeats the value it overrides.
 */

/** The small caption in front of a group of chips ("Status", "Type"). */
export const FILTER_GROUP_LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

const CHIP_BASE =
  "inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40";
const CHIP_ON = "border-brand-300 bg-brand-soft text-brand-ink";
const CHIP_OFF = "border-line bg-surface text-ink/70 hover:border-brand-300 hover:bg-brand-soft";

export function filterChipClass(active: boolean): string {
  return `${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF}`;
}

/** The count beside a chip's label, and the badge on a dropdown's trigger. */
export function filterCountClass(active: boolean): string {
  return `rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
    active ? "bg-surface text-brand-ink" : "bg-soft text-ink/70"
  }`;
}

const TRIGGER_BASE =
  "inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40";

/** The button that opens a facet's checkbox panel. */
export function filterTriggerClass(active: boolean): string {
  return `${TRIGGER_BASE} ${
    active
      ? "border-brand-300 bg-brand-soft text-brand-ink"
      : "border-line bg-surface text-ink/70 hover:border-brand-300 hover:bg-brand-soft"
  }`;
}

/** The panel of checkboxes under a trigger. */
export const FILTER_PANEL =
  "absolute left-0 z-30 mt-2 max-h-72 w-60 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-card";

/** One checkbox row inside a panel. */
export const FILTER_OPTION_ROW =
  "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-ink/70 hover:bg-soft";

export const FILTER_CHECKBOX = "h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-600";

/** The number of rows an option would show. */
export const FILTER_OPTION_COUNT = "shrink-0 text-[11px] tabular-nums text-muted";

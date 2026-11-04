"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  selectionQuery,
  toggleFilterOption,
  type FilterGroup,
  type FilterSelection,
} from "@/lib/filter-options";
import {
  FILTER_CHECKBOX,
  FILTER_OPTION_COUNT,
  FILTER_OPTION_ROW,
  FILTER_PANEL,
  filterCountClass,
  filterTriggerClass,
} from "@/components/filterChipStyles";

/**
 * The filter control: one dropdown per facet, each a panel of checkboxes.
 *
 * WHY CHECKBOXES. The earlier control was a row of single-choice chips, so "open
 * OR in progress" could not be asked at all — the admin had to read two lists in
 * turn. A checkbox set makes a facet multi-select (an OR inside the facet) while
 * facets stay ANDed with each other, which is how an operations queue is actually
 * queried: "technical issues that are open or in progress".
 *
 * WHY A DROPDOWN. Six facets as chips spent three rows of vertical space above
 * every table, and the space grew with the vocabulary. Closed, each facet is one
 * button carrying its own count; open, it shows its whole vocabulary and how many
 * rows each option would show.
 *
 * The panel is a real disclosure: `aria-expanded` on the trigger, `aria-controls`
 * pointing at the panel, Escape and a click outside to close. A count inside the
 * trigger says how many options are ticked, so a closed dropdown still reports
 * whether it is filtering anything.
 *
 * Two exports, one control:
 *   * `FilterDropdowns` — for the client lists, where the rows are already in the
 *     browser and a tick can re-render instantly;
 *   * `FilterDropdownLinks` — for the server-rendered lists, where a tick is a
 *     navigation. A function prop cannot cross the server/client boundary, so it
 *     is given the `basePath` and builds the query string itself.
 */

function FacetDropdown({
  group,
  selectedKeys,
  onToggle,
}: {
  group: FilterGroup;
  selectedKeys: string[];
  onToggle: (optionKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const ticked = selectedKeys.length;

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={filterTriggerClass(ticked > 0)}
      >
        {group.label}
        {ticked > 0 && <span className={filterCountClass(true)}>{ticked}</span>}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={`Filter by ${group.label}`}
          className={FILTER_PANEL}
        >
          {group.options.map((option) => (
            <label key={option.key} className={FILTER_OPTION_ROW}>
              <input
                type="checkbox"
                className={FILTER_CHECKBOX}
                checked={option.selected}
                onChange={() => onToggle(option.key)}
              />
              <span className="flex-1">{option.label}</span>
              {/* The rows this option would show, given everything else ticked. */}
              <span className={FILTER_OPTION_COUNT}>{option.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Checkbox dropdowns for a list whose rows are already in the browser. */
export default function FilterDropdowns({
  groups,
  selected,
  onChange,
}: {
  groups: FilterGroup[];
  selected: FilterSelection;
  onChange: (next: FilterSelection) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {groups.map((group) => (
        <FacetDropdown
          key={group.key}
          group={group}
          selectedKeys={selected[group.key] ?? []}
          onToggle={(optionKey) => onChange(toggleFilterOption(selected, group.key, optionKey))}
        />
      ))}
    </div>
  );
}

/**
 * The same control for a server-rendered list, where a tick is a navigation.
 *
 * `scroll: false` keeps the table where it was: filtering a long list should not
 * throw the admin back to the top of the page.
 */
export function FilterDropdownLinks({
  groups,
  selected,
  basePath,
}: {
  groups: FilterGroup[];
  selected: FilterSelection;
  basePath: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {groups.map((group) => (
        <FacetDropdown
          key={group.key}
          group={group}
          selectedKeys={selected[group.key] ?? []}
          onToggle={(optionKey) => {
            const next = toggleFilterOption(selected, group.key, optionKey);
            const query = selectionQuery(groups, next);
            router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
          }}
        />
      ))}
    </div>
  );
}

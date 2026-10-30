"use client";

import { Printer } from "lucide-react";

/**
 * "Print → Save as PDF" IS the PDF export.
 *
 * The app ships no PDF library on purpose: a print stylesheet produces a better
 * document than a hand-rolled renderer, keeps the file size at zero, and works on
 * every device the customer already has. The chrome hides itself with
 * `print:hidden`, so what comes out of the printer is the job order alone.
 */
export default function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition duration-200 hover:bg-soft print:hidden"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

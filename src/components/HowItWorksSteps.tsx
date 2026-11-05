"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * "How SPARKServ works" — the three steps across, under a centred heading.
 *
 * THE SHAPE. Eyebrow, heading and subtext centred at the top, then one column per step:
 * the app screen, its number and title, its description. All three are always visible —
 * there is no open/closed state, no arrow to click and nothing to scroll through.
 *
 * WHY THERE IS NO PINNING OR ACCORDION. The previous version pinned this section under
 * the navbar for three screens of scroll and kept one step expanded. It worked, but the
 * pin held a ~550px block inside a full-height frame, so roughly 200px of empty page sat
 * above and below the content at every scroll position, and the two columns (a tall
 * picture, a short accordion) were centred independently of each other. This layout has
 * no frame to fill, so there is nothing left empty: the section is exactly as tall as
 * its own content.
 *
 * THE ARTWORK. Each step is a 1200×1500 screen mockup — portrait, on black, with a cyan
 * glow. The panel is the artwork's own 4:5, and the picture is zoomed by 1.4 so the ~15%
 * black margin and the glow ring the files carry are cropped away and the screen itself
 * fills the card. `onError` swaps in a neutral placeholder if a file is ever missing, so
 * a rename cannot leave a broken image on the homepage.
 */
const STEPS = [
  {
    number: "01",
    title: "Describe the Problem",
    description: "Select your appliance, brand, model, and describe the issue.",
    image: "/images/step-1.png",
  },
  {
    number: "02",
    title: "Review Your Estimate",
    description: "Get a preliminary estimate and approve any additional costs.",
    image: "/images/step-2.png",
  },
  {
    number: "03",
    title: "Track Your Repair",
    description: "Follow your repair from assignment to completion.",
    image: "/images/step-3.png",
  },
];

export default function HowItWorksSteps() {
  /** Which pictures failed to load, so a missing file shows a placeholder, not a broken icon. */
  const [failed, setFailed] = useState<boolean[]>(() => STEPS.map(() => false));

  return (
    <section aria-labelledby="how-it-works-heading" className="border-y border-line bg-canvas">
      <div className="spark-section py-12 md:py-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="spark-eyebrow text-brand-600 dark:text-[#81EDF4]">How SPARKServ works</p>
          <h2
            id="how-it-works-heading"
            className="mt-2 text-2xl font-bold text-ink sm:text-3xl"
          >
            From problem to service in 3 steps
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted md:text-base">
            Tell us what&apos;s wrong, review your estimate, and track your repair, all in one place.
          </p>
        </div>

        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.number} className="group md:text-center">
              <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-line bg-black transition-colors duration-300 group-hover:border-brand-600/40 dark:group-hover:border-[#81EDF4]/40">
                {failed[index] ? (
                  <StepPlaceholder number={step.number} />
                ) : (
                  <Image
                    src={step.image}
                    alt={`Step ${index + 1} of ${STEPS.length}: ${step.title}`}
                    fill
                    priority={index === 0}
                    loading={index === 0 ? undefined : "lazy"}
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="scale-[1.4] object-cover"
                    onError={() =>
                      setFailed((previous) =>
                        previous.map((value, failedIndex) => (failedIndex === index ? true : value))
                      )
                    }
                  />
                )}
              </div>

              <h3 className="mt-4 flex items-baseline gap-2.5 md:justify-center">
                <span className="font-mono text-[11px] leading-none tracking-[0.14em] text-brand-600 dark:text-[#81EDF4]">
                  {step.number}
                </span>
                <span className="text-sm font-semibold text-ink md:text-base">{step.title}</span>
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-muted md:mx-auto md:max-w-xs">
                {step.description}
              </p>

            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Stands in for a picture that has not been added yet. Deliberately neutral: a dashed
 * outline and the step number, no invented artwork and no broken-image icon. It is only
 * rendered after the browser has reported that the file could not be loaded, so adding
 * the file under `public/images` makes it disappear by itself.
 */
function StepPlaceholder({ number }: { number: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <span className="h-10 w-10 rounded-lg border border-dashed border-line" />
      <span className="font-mono text-[11px] tracking-[0.14em] text-muted">{number}</span>
    </div>
  );
}

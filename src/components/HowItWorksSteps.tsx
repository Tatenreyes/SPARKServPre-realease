"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

/**
 * "How SPARKServ works" — a two-column section: the picture on the left, the steps on
 * the right, one of them open at a time.
 *
 * WHAT DRIVES THE ACTIVE STEP. Three things, and they do not fight each other:
 *
 *   1. A click, or Enter/Space on a focused step button.
 *   2. Hovering a step — but only for a real mouse (`onPointerEnter` plus a
 *      `pointerType` check), because a tap would otherwise leave a step selected on a
 *      phone that has no pointer to move away.
 *   3. Scrolling. The section is given a tall runway and the content inside it is
 *      `position: sticky`, so the whole thing appears to pin while the runway passes.
 *      Three invisible blocks tile that runway and an IntersectionObserver watches a
 *      zero-height band across the middle of the viewport, so whichever block the
 *      centre line is inside owns the section. No GSAP here, and no scroll listener.
 *
 * The active index is a plain number, and the pictures' slide direction is DERIVED from
 * it rather than stored: a picture whose index is below the active one sits 36px to the
 * left, one above sits 36px to the right, and the active one sits at zero. Advancing
 * therefore slides the outgoing picture away in one direction and brings the incoming
 * one in from the other, and going back up the list reverses both — with no extra state
 * to keep in step.
 *
 * MOTION. The crossfade, the slide and the scale are CSS transitions; `motion-safe:` on
 * the transform classes means a visitor who prefers reduced motion gets the crossfade
 * alone, with nothing moving or scaling. The accordion's `grid-template-rows` opening
 * is likewise dropped under `motion-reduce:`, so the panel appears without animating
 * its height.
 *
 * ONE ACCENT. `#81EDF4`, the cyan the eyebrow in this section already uses: the open
 * step's left border, its number, and the filled circle around its arrow. Everything
 * else is the section's existing white/near-black palette.
 */

/** The three steps. Titles and descriptions are unchanged from the section this replaced. */
const STEPS = [
  {
    number: "01",
    title: "Describe the Problem",
    description: "Select your appliance, brand, model, and describe the issue.",
    // The three supplied screen mockups. They are portrait, on black, with a cyan glow,
    // which is why the panel below is black and the pictures are `object-contain`: a
    // `cover` crop would slice the title and the button off each mockup.
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
  const [activeIndex, setActiveIndex] = useState(0);
  /** Which images failed to load, so a missing file shows a placeholder, not a broken icon. */
  const [failed, setFailed] = useState<boolean[]>(() => STEPS.map(() => false));
  const stepRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRefs = useRef<Array<HTMLDivElement | null>>([]);

  /**
   * Arrow keys walk the list and take focus with them, so the open step and the focused
   * step are always the same one. Enter and Space need no handling: they are what a
   * `<button>` already does.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = STEPS.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = Math.min(last, activeIndex + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = Math.max(0, activeIndex - 1);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }

    if (next === null) return;

    event.preventDefault();
    setActiveIndex(next);
    stepRefs.current[next]?.focus();
  }

  /**
   * The scroll half of the section, and only from 768px up: on a phone the steps are
   * tapped, and the media listener re-runs this if the window is resized across the
   * breakpoint so no observer is left watching a layout that is no longer there.
   */
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    let observer: IntersectionObserver | null = null;

    const connect = () => {
      observer?.disconnect();
      observer = null;
      if (!desktop.matches) return;

      const triggers = triggerRefs.current.filter((node): node is HTMLDivElement => Boolean(node));
      if (triggers.length !== STEPS.length) return;

      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const index = triggers.indexOf(entry.target as HTMLDivElement);
            if (index >= 0) setActiveIndex(index);
          }
        },
        // A zero-height band across the middle of the viewport. The blocks tile the
        // runway without overlapping, so exactly one of them can ever be in it.
        { rootMargin: "-50% 0px -50% 0px", threshold: 0 }
      );

      triggers.forEach((node) => observer?.observe(node));
    };

    connect();
    desktop.addEventListener("change", connect);

    return () => {
      observer?.disconnect();
      desktop.removeEventListener("change", connect);
    };
  }, []);

  return (
    <section aria-labelledby="how-it-works-heading" className="border-y border-white/10 bg-[#070D12]">
      <div className="spark-section">
        {/* The runway. On a phone this is an ordinary block; from 768px up its height is
            the scroll distance the three steps share, and the content inside it is
            sticky — which is what makes the section look pinned while they advance. */}
        <div className="relative md:min-h-[220vh]">
          <div className="md:sticky md:top-16 md:flex md:min-h-[calc(100vh_-_4rem)] md:items-center">
            <div className="grid w-full gap-6 py-12 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-12 md:py-14">
              {/* ── Left: the image panel. All three pictures are stacked in it; only the
                  active one is at full opacity, and the others are parked 36px to one
                  side, so changing step is a crossfade with a slide. The panel IS the
                  artwork's own 4:5 (all three mockups are 1200×1500), so the picture
                  fills it with no letterboxing and no crop, and it is sized by width so
                  the grid column beside it can hug it — height follows from the ratio and
                  is capped at 60vh, which keeps the pinned section inside the viewport. ── */}
              <div className="relative mx-auto aspect-[4/5] w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-black md:w-[min(440px,48vh)] md:max-w-none">
                {STEPS.map((step, index) => {
                  const isActive = index === activeIndex;
                  return (
                    <div
                      key={step.image}
                      aria-hidden={!isActive}
                      className={`absolute inset-0 transition-[opacity,transform] duration-[650ms] ease-out ${
                        isActive
                          ? "opacity-100 motion-safe:translate-x-0 motion-safe:scale-100"
                          : `opacity-0 motion-safe:scale-[0.96] ${
                              index < activeIndex
                                ? "motion-safe:-translate-x-9"
                                : "motion-safe:translate-x-9"
                            }`
                      }`}
                    >
                      {failed[index] ? (
                        <StepPlaceholder number={step.number} />
                      ) : (
                        <Image
                          src={step.image}
                          alt={`Step ${index + 1} of ${STEPS.length}: ${step.title}`}
                          fill
                          priority={index === 0}
                          loading={index === 0 ? undefined : "lazy"}
                          sizes="(min-width: 768px) 440px, 100vw"
                          // `cover` fills the 4:5 panel exactly; the zoom then crops the
                          // ~15% black border and the glow circle the source PNGs carry
                          // around the UI card, so the screen itself fills the card
                          // instead of floating small inside it. The panel's
                          // `overflow-hidden` does the clipping.
                          className="scale-[1.4] object-cover"
                          onError={() =>
                            setFailed((previous) =>
                              previous.map((value, failedIndex) =>
                                failedIndex === index ? true : value
                              )
                            )
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Right: label, heading, subtext, then the steps as an accordion. ── */}
              <div>
                <p className="spark-eyebrow text-[#81EDF4]">How SPARKServ works</p>
                <h2
                  id="how-it-works-heading"
                  className="mt-2 text-2xl font-bold text-white sm:text-3xl"
                >
                  From problem to service in 3 steps
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/70 md:text-base">
                  Tell us what&apos;s wrong, review your estimate, and track your repair, all in one place.
                </p>

                <div
                  role="group"
                  aria-label="The three steps"
                  onKeyDown={handleKeyDown}
                  className="mt-7 border-t border-white/10"
                >
                  {STEPS.map((step, index) => {
                    const isActive = index === activeIndex;
                    return (
                      <div
                        key={step.number}
                        className={`border-b border-l-2 border-white/10 transition-colors duration-300 ${
                          isActive ? "border-l-[#81EDF4]" : "border-l-transparent"
                        }`}
                      >
                        <h3>
                          <button
                            ref={(node) => {
                              stepRefs.current[index] = node;
                            }}
                            type="button"
                            id={`how-it-works-step-${index + 1}`}
                            aria-controls={`how-it-works-panel-${index + 1}`}
                            aria-expanded={isActive}
                            aria-current={isActive ? "true" : undefined}
                            onClick={() => setActiveIndex(index)}
                            onPointerEnter={(event) => {
                              if (event.pointerType === "mouse") setActiveIndex(index);
                            }}
                            className="group flex w-full items-center gap-4 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12] md:py-5"
                          >
                            <span
                              className={`font-mono text-[11px] leading-none tracking-[0.14em] transition-colors duration-300 ${
                                isActive ? "text-[#81EDF4]" : "text-white/40"
                              }`}
                            >
                              {step.number}
                            </span>
                            <span
                              className={`flex-1 text-sm font-semibold transition-colors duration-300 md:text-base ${
                                isActive ? "text-white" : "text-white/55 group-hover:text-white/80"
                              }`}
                            >
                              {step.title}
                            </span>
                            {/* A filled circle while the step is open, a bare arrow while it is shut. */}
                            <span
                              aria-hidden="true"
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
                                isActive ? "bg-[#81EDF4] text-[#070D12]" : "text-white/45"
                              }`}
                            >
                              <ArrowRight className="h-4 w-4" />
                            </span>
                          </button>
                        </h3>

                        {/* The height animation: a grid row going 0fr → 1fr, which is the
                            one way to animate to "as tall as the content" without
                            measuring it. Under reduced motion the transition is dropped, so
                            the panel simply appears. */}
                        <div
                          id={`how-it-works-panel-${index + 1}`}
                          className={`grid transition-[grid-template-rows] duration-[450ms] ease-out motion-reduce:transition-none ${
                            isActive ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                          }`}
                        >
                          <div className="overflow-hidden">
                            <p className="px-4 pb-5 text-sm leading-6 text-white/70">
                              {step.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>

          {/* The scroll triggers. Three blocks tiled across the middle of the runway, so
              the centre of the viewport is inside exactly one of them at a time. They are
              invisible and cannot be interacted with. `top-[50vh] h-[120vh]` lines their
              span up with the stretch of scroll during which the sticky content is
              actually pinned, which gives each step the same 40vh of travel. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-[50vh] hidden h-[120vh] md:block"
          >
            {STEPS.map((step, index) => (
              <div
                key={step.number}
                ref={(node) => {
                  triggerRefs.current[index] = node;
                }}
                className="h-1/3"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Stands in for a picture that has not been added yet. Deliberately neutral: a dashed
 * outline and the step number, no invented artwork and no broken-image icon. It is only
 * rendered after the browser has reported that the file could not be loaded, so adding
 * the file under `public/images/how-it-works` makes it disappear by itself.
 */
function StepPlaceholder({ number }: { number: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <span className="h-10 w-10 rounded-lg border border-dashed border-white/20" />
      <span className="font-mono text-[11px] tracking-[0.14em] text-white/35">{number}</span>
    </div>
  );
}

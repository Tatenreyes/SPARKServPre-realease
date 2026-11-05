"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Registered once, at module level, and only in the files that use it.
 */
gsap.registerPlugin(ScrollTrigger);

/**
 * Smooth scrolling, wired so Lenis and GSAP's ScrollTrigger share one clock.
 *
 * WHY BOTH LIBRARIES. Lenis damps the scroll position; ScrollTrigger reads it. Left
 * alone they drift a frame or two apart and a pinned section stutters, so each Lenis
 * frame is pushed into ScrollTrigger (`lenis.on("scroll", ScrollTrigger.update)`) and
 * `lenis.raf` is stepped by `gsap.ticker` instead of Lenis's own loop
 * (`autoRaf: false`, passed explicitly so it cannot double-step if the default
 * changes). `lagSmoothing(0)` stops GSAP from papering over a dropped frame with a
 * jump, which is what a pinned section would show as a lurch.
 *
 * REDUCED MOTION: no instance is created at all. Lenis would honour the preference
 * itself (it forces `lerp` to 1), but there is nothing here worth keeping alive for
 * a visitor who asked for less motion: native scrolling is correct, the CSS block in
 * `globals.css` is keyed on a class only Lenis adds, and the steps section does not
 * pin. So `prefers-reduced-motion` gets a plain, unmodified page.
 *
 * Renders a fragment on purpose. Wrapping the tree in an element would put a box
 * around `<Navbar />` and `<main>`, and the navbar is `sticky top-0`: a wrapper with
 * its own stacking/containing behaviour is exactly what breaks that.
 */
export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true, autoRaf: false });
    const syncScrollTrigger = () => ScrollTrigger.update();
    lenis.on("scroll", syncScrollTrigger);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    /**
     * Anything that lands after the first measure — the hero photograph, the webfonts
     * — moves every trigger's start. `ScrollTrigger.refresh()` re-reads them, and
     * without it the steps section can pin a few dozen pixels off, or unpin early.
     */
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);

    return () => {
      window.removeEventListener("load", refresh);
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}

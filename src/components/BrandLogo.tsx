import Image from "next/image";

/* The mark is square, so `size` is both its width and its height. */

/**
 * The SparkServ mark, centred on a small white tile.
 *
 * ## Why a tile, and why white
 *
 * Both supplied artworks are cut-outs, transparent at the corners and drawn in
 * the brand blue, so they need a plate: on the sidebar's navy the mark would
 * otherwise be blue on blue at roughly 1.1:1. A white plate carries it on the
 * light navbar and on the navy bands alike, in either theme.
 *
 * ## Two files, one mark
 *
 * `sparkserv-icon-light.png` is the deeper blue (about #3168CE) and
 * `sparkserv-icon-dark.png` the brighter one (about #4B82EB) for the dark
 * canvas; the geometry is identical, so the artwork swap is the only difference
 * between the themes. Both are PNGs on purpose: this mark is drawn through
 * `next/image`, and the project sets no `images.dangerouslyAllowSVG`, so an SVG
 * source would be refused at runtime.
 *
 * `size` is the tile's edge: the mark is square, not the wide lockup this
 * replaced, so the width follows the height.
 */
export default function BrandLogo({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const width = size;
  const imageClass = "h-full w-full object-contain p-[8%]";

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center ${className}`}
      style={{ width, height: size }}
    >
      <span className="flex h-full w-full items-center justify-center rounded-lg bg-white ring-1 ring-black/5">
        <Image
          src="/icons/sparkserv-icon-light.png"
          alt="SPARKServ"
          width={width}
          height={size}
          className={`${imageClass} dark:hidden`}
          priority
        />
        {/* The same mark in its dark-canvas blue. Both are rendered and the CSS
            class decides which one is painted, so the theme toggle needs no state
            and cannot flash the wrong logo. `priority` stays on the light copy,
            the one the default theme shows. */}
        <Image
          src="/icons/sparkserv-icon-dark.png"
          alt=""
          aria-hidden="true"
          width={width}
          height={size}
          className={`${imageClass} hidden dark:block`}
        />
      </span>
    </span>
  );
}

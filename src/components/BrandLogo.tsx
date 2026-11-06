import Image from "next/image";

/* The mark is square, so `size` is both its width and its height. */

/**
 * The SparkServ mark.
 *
 * ## Two files, one mark
 *
 * `sparkserv-icon-light.png` and `sparkserv-icon-dark.png` are the same geometry
 * with different blues, so the theme only swaps which artwork is painted. Both
 * are PNGs on purpose: this mark is drawn through `next/image` and the project
 * sets no `images.dangerouslyAllowSVG`, so an SVG source would be refused at
 * runtime.
 *
 * ## The plate
 *
 * The artwork is a transparent cut-out drawn in the brand blue, so on a navy band
 * the mark alone is blue on blue at roughly 1.1:1 and the white tile is what
 * carries it. `plate` is on by default for those surfaces; the headers pass
 * `plate={false}` so the mark sits directly on the bar's own background.
 *
 * `size` is the tile's edge: the mark is square, not the wide lockup this
 * replaced, so the width follows the height.
 */
export default function BrandLogo({
  size = 32,
  className = "",
  plate = true,
}: {
  size?: number;
  className?: string;
  /** The white tile behind the mark. See above. */
  plate?: boolean;
}) {
  const width = size;
  const imageClass = "h-full w-full object-contain p-[8%]";

  const mark = (
    <>
      <Image
        src="/icons/sparkserv-icon-light.png"
        alt="SPARKServ"
        width={width}
        height={size}
        className={`${imageClass} dark:hidden`}
        priority
      />
      {/* The dark-canvas copy. Both are rendered and a CSS class decides which is
          painted, so the theme toggle needs no state and cannot flash the wrong
          logo. `priority` stays on the light copy, the default theme's. */}
      <Image
        src="/icons/sparkserv-icon-dark.png"
        alt=""
        aria-hidden="true"
        width={width}
        height={size}
        className={`${imageClass} hidden dark:block`}
      />
    </>
  );

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center ${className}`}
      style={{ width, height: size }}
    >
      {plate ? (
        <span className="flex h-full w-full items-center justify-center rounded-lg bg-white ring-1 ring-black/5">
          {mark}
        </span>
      ) : (
        mark
      )}
    </span>
  );
}

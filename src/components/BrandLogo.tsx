import Image from "next/image";

/* The mark is square, so `size` is both its width and its height. */

/**
 * The SparkServ mark, centred on a small white tile.
 *
 * ## Why a tile, and why white
 *
 * The supplied artwork is a cut-out drawn in the brand blue (`#1155EE` — 89% of
 * the mark, with a yellow accent). The old `light` variant was a white wordmark,
 * which is why the mark disappeared on the light navbar, and a brand-blue tile
 * would be blue on blue at about 1.1:1. A white plate carries the mark on the
 * light navbar and on the navy bands alike, in either theme.
 *
 * `size` is the tile's edge: the mark is square now, not the wide lockup this
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
          className={imageClass}
          priority
        />
      </span>
    </span>
  );
}

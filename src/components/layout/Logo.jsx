// ============================================================================
// Brand mark.
//
// A CSS/SVG mark rather than a raster logo: it stays crisp at every size, costs
// no request, and inherits the theme tokens automatically.
// ============================================================================
import Link from "next/link";

export default function Logo({ href = "/", size = "md", showWordmark = true, className = "" }) {
  const box = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 ${className}`} aria-label="ITOPUP — beranda">
      <span
        className={`${box} relative flex shrink-0 items-center justify-center rounded-[0.7rem] bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm`}
      >
        {/* Lightning bolt: "instant". Decorative, so it is hidden from AT. */}
        <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13.5 2 4 13.2h6.2L9.8 22 20 10.6h-6.4L13.5 2Z" />
        </svg>
      </span>
      {showWordmark ? (
        <span className={`${text} font-extrabold tracking-tight text-foreground`}>
          ITO<span className="text-brand-600 dark:text-brand-400">PUP</span>
        </span>
      ) : null}
    </Link>
  );
}

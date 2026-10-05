// ============================================================================
// Brand mark.
//
// The artwork is the customer's own SVG (the same file served as the site
// favicon at src/app/icon.svg), inlined rather than <img>-loaded: it stays
// crisp at every size, costs no request, and inherits nothing it should not.
//
// The source canvas is 1080x1350 and the artwork sits inside it, so the mark
// file carries a viewBox cropped to the art itself (measured from the real ink
// bounding box). Without that crop the art would render as a small shape
// floating inside a tall letterbox.
// ============================================================================
import Link from "next/link";

// Inlined so the mark ships in the JS chunk and never blocks on a request.
// Kept here (not in /public) because it is identity, not content: /public is
// for brand art that is looked up by slug at runtime.
const MARK_SVG = (
  <svg viewBox="142.4 277.1 794.3 794.3" className="h-full w-full" aria-hidden="true">
    <path
      fill="#1D4ED8"
      d="M893.3,770.7l-4.9,14.6H779.1c-4.8,0-9.2,2-12.4,5.1c-3.2,3.2-5.1,7.5-5.1,12.4c0,9.7,7.8,17.5,17.5,17.5h97.6l-9.7,29H737.1c-4.8,0-9.2,2-12.4,5.1c-3.2,3.2-5.1,7.5-5.1,12.4c0,9.7,7.8,17.5,17.5,17.5h118.1l-7.7,23H685.1c-4.8,0-9.2,2-12.4,5.1c-3.2,3.2-5.1,7.5-5.1,12.4c0,9.7,7.8,17.5,17.5,17.5h150.6l-5,14.8c-4,12-16.6,20.2-30.9,20.2H303.4c-0.7,0-1.4,0-2.1-0.1c2.4-0.3,4.9-0.9,7.2-1.9l387.6-164.5c11.2-4.7,17.8-16.5,16.2-28.8l-5.9-47.1h155.9C883.8,734.8,899.3,752.8,893.3,770.7z"
    />
    <path
      fill="#144DB2"
      d="M696.1,810.8L308.5,975.3c-2.4,1-4.8,1.6-7.2,1.9c-14.6,1.8-28.9-8.9-30.9-24.8l-8.7-69.8l26.7-9.6l8.1-2.9l113.9-41l40.4-14.5c14.7-5.3,23.8-19.1,23.8-33.9c0-4-0.7-8.2-2.1-12.2c-0.3-0.9-0.7-1.8-1.1-2.6c-7.7-17-27.2-25.5-45-19.1l-100.8,36.3L335,755c4-12,16.6-20.2,30.9-20.2h340.6l5.9,47.1C713.9,794.3,707.3,806,696.1,810.8z"
    />
    <path
      fill="#3268E0"
      d="M706.5,734.8H365.9c-14.3,0-26.9,8.2-30.9,20.2l-9.4,28.1l-73.1,26.3l-6.1-49.2c-1.5-12.3,5.1-24.1,16.2-28.8L642.7,570l7.5-3.2c16.8-7.1,35.9,4.3,38.2,22.8L706.5,734.8z"
    />
    <path
      fill="#5183F2"
      d="M629.7,562L249.6,723.3c-11.2,4.7-17.8,16.5-16.2,28.8l6.1,49.2l-0.9,0.3l-49.4-85.1c-6.2-10.8-4.7-24.2,3.7-32.9l292.5-302.9c10.9-11.3,28.9-10.6,39.6,0.3c0.6,0.6,1.2,1.3,1.8,2.1c1,1.2,1.8,2.4,2.6,3.8l97.2,167.6C628.1,556.9,629.1,559.4,629.7,562z"
    />
    <circle fill="#1D4ED8" cx="433.6" cy="782.3" r="19.5" />
  </svg>
);

export default function Logo({ href = "/", size = "md", showWordmark = true, className = "" }) {
  const box = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 ${className}`} aria-label="ITOPUP beranda">
      <span className={`${box} relative flex shrink-0 items-center justify-center rounded-[0.7rem] bg-white shadow-sm ring-1 ring-black/5 dark:bg-white/5 dark:ring-white/10`}>
        {MARK_SVG}
      </span>
      {showWordmark ? (
        <span className={`${text} font-extrabold tracking-tight text-foreground`}>
          ITO<span className="text-brand-600 dark:text-brand-400">PUP</span>
        </span>
      ) : null}
    </Link>
  );
}

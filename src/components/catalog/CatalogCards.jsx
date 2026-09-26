// ============================================================================
// Shared storefront cards.
//
// Server components: no state, no effects, no data fetching. They render what
// they are given, which keeps the catalog pages free of client JS.
// ============================================================================
import Link from "next/link";
import { gameIcon } from "@/config/icons.js";

/** Deterministic gradient per slug, so a game without artwork still looks designed. */
function gradientFor(seed) {
  const palettes = [
    "from-brand-500 to-brand-700",
    "from-sky-500 to-brand-700",
    "from-indigo-500 to-brand-700",
    "from-cyan-500 to-brand-600",
    "from-blue-500 to-indigo-700",
    "from-violet-500 to-brand-700",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 9973;
  return palettes[hash % palettes.length];
}

/** First letters of a game name, for the artwork placeholder. */
function initialsOf(name) {
  return String(name || "?")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function GameArtwork({ game, className = "h-14 w-14 text-lg" }) {
  // The brand icon is preferred, and falls back to the branded-initials tile
  // when a game has no artwork checked in yet. `game.logo` is a provider- or
  // admin-supplied URL and still wins, so an operator can override without a
  // code change (that path is what the DB `logo` column exists for).
  const icon = game.logo ?? gameIcon(game.slug);

  if (icon) {
    return (
      // Plain <img>: these are brand brand marks of unknown dimensions.
      // next/image would need remotePatterns per host; local /public files are
      // served as-is anyway, and an <img> here keeps the component isomorphic.
      <img
        src={icon}
        alt=""
        className={`${className} rounded-xl object-cover`}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span
      className={`${className} flex items-center justify-center rounded-xl bg-gradient-to-br ${gradientFor(game.slug || game.name)} font-bold text-white`}
      aria-hidden="true"
    >
      {initialsOf(game.name)}
    </span>
  );
}

/**
 * Game card for the catalog grids and the homepage.
 * `categoryPath` is passed in rather than derived, so the card never has to
 * know how a category maps to a URL segment.
 */
export function GameCard({ game, categoryPath, className = "" }) {
  const href = `/topup/${categoryPath}/${game.slug}`;
  return (
    <Link
      href={href}
      className={`card-interactive group flex flex-col items-center gap-3 p-4 text-center ${className}`}
    >
      <GameArtwork game={game} />
      <span className="min-w-0 w-full">
        <span className="block truncate text-sm font-semibold text-foreground">{game.name}</span>
        {game.publisher ? (
          <span className="mt-0.5 block truncate text-xs text-foreground-subtle">{game.publisher}</span>
        ) : null}
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-brand-400">
        Top Up
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      </span>
    </Link>
  );
}

/** Section heading with an optional "see all" link. */
export function SectionHeading({ title, description, href, linkLabel = "Lihat semua", className = "" }) {
  return (
    <div className={`mb-5 flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-foreground-muted">{description}</p>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="shrink-0 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

/** Category tile for the /topup hub. */
export function CategoryCard({ category, count, className = "" }) {
  return (
    <Link href={category.path} className={`card-interactive flex items-center gap-4 p-5 ${className}`}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-600 dark:text-brand-400">
        <CategoryIcon name={category.icon} />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-foreground">{category.name}</span>
        <span className="mt-0.5 block text-sm text-foreground-muted">
          {count > 0 ? `${count} layanan tersedia` : category.description || "Segera hadir"}
        </span>
      </span>
      <svg className="ml-auto h-5 w-5 shrink-0 text-foreground-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  );
}

export function CategoryIcon({ name, className = "h-6 w-6" }) {
  const paths = {
    gamepad: "M6 12h4m-2-2v4m7-1h.01M17 9h.01M7 6h10a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5v-2a5 5 0 0 1 5-5Z",
    wallet: "M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2m0 0v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8m16 4h-3a2 2 0 0 0 0 4h3",
    signal: "M2 20h.01M7 20v-4m5 4v-8m5 8V8m5 12V4",
  };
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[name] ?? paths.gamepad} />
    </svg>
  );
}

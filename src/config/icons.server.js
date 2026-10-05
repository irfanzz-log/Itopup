// ============================================================================
// Game icon files: server-only.
//
// src/config/icons.js is imported by CLIENT components (the catalogue cards,
// the checkout rail). Reading the /public directory with node:fs from that
// module leaks the fs request into the browser bundle and Turbopack refuses to
// emit the chunk ("the chunking context does not support external modules
// (request: node:fs)").
//
// So the directory scan lives HERE, behind `import "server-only"`, and the
// client-safe module receives the result as a value. The split is the same one
// the codebase already uses for payment config (src/config/payment.server.js).
// ============================================================================
import "server-only";
import { readdirSync } from "node:fs";
import path from "node:path";

const ICONS_ROOT = path.resolve(process.cwd(), "public/icons");

const GAME_ICON_EXTS = [".webp", ".png", ".jpg", ".jpeg", ".svg"];

/**
 * Scan /public/icons/games and map `slug → "games/<file>"`.
 *
 * File names are 1:1 with the game slug, so a new game needs no code change;
 * drop the artwork in and the map picks it up on the next server render. A
 * hand-written list here is what let games sit without artwork until someone
 * remembered to add the line.
 *
 * @returns {Record<string, string>}
 */
export function scanGameIcons() {
  const out = {};
  let names = [];
  try {
    names = readdirSync(path.join(ICONS_ROOT, "games"));
  } catch {
    // Directory missing (a build without /public mounted, or a fresh checkout
    // before assets are restored). An empty map degrades gracefully: cards fall
    // back to branded initials, which is visible and fixable, rather than
    // failing the build over artwork.
    names = [];
  }

  for (const name of names) {
    const dot = name.lastIndexOf(".");
    if (dot < 1) continue;
    const ext = name.slice(dot).toLowerCase();
    if (!GAME_ICON_EXTS.includes(ext)) continue;
    const slug = name.slice(0, dot);
    if (!slug) continue;
    // Two files for one slug (codm.jpg and codm.webp) would otherwise both map
    // and the last one wins arbitrarily. First-seen keeps the existing asset.
    if (!(slug in out)) out[slug] = `games/${name}`;
  }
  return out;
}

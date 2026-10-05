// Fetch brand thumbnails (CDN) for every active game, and download them into
// /public/icons/games so icons are local — the same policy as the existing ones
// (see the header comment in src/config/icons.js: never hotlink a brand CDN).
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import { call } from "../src/providers/melostore/client.js";

// Map our game slug -> the brand name Melostore uses, so we can match the
// thumbnail. Falls back to a prefix match on the brand name.
const BRAND_FOR_SLUG = {
  "age-of-empires-mobile": "Age of Empires Mobile",
  "arena-breakout": "Arena Breakout",
  "call-of-duty-mobile": "Call Of Duty Mobile",
  "codm": "Call Of Duty Mobile",
  "dragon-raja": "Dragon Raja (SEA)",
  "eggy-party": "Eggy Party",
  "ensemble-stars-music": "Ensemble Stars Music",
  "farlight-84": "Farlight 84",
  "football-master-2": "Football Master 2",
  "free-fire-max": "Free Fire Max (Global)",
  "hatsune-miku-colorful-stage": "Hatsune Miku: Colorful Stage",
  "hero-clash": "Hero Clash",
  "honor-of-kings": "Honor of Kings",
  "infinite-lagrange": "Infinite Lagrange",
  "lords-mobile": "Lords Mobile",
  "magic-chess-go-go": "Magic Chess Go Go (Global)",
  "marvel-rivals": "Marvel Rivals",
  "omega-legends": "Omega Legends",
  "pixel-gun-3d": "Pixel Gun 3D",
  "super-sus": "Super SUS",
  "telegram-stars": "Telegram Stars (Via Username)",
  "watcher-of-realms": "Watcher of Realms",
  "whiteout-survival": "Whiteout Survival",
  "yalla-ludo": "Yalla Ludo",
  "zepeto": "Zepeto",
};

describe("thumbnails", () => {
  it("downloads brand artwork for the active games", async () => {
    const games = await prisma.game.findMany({
      where: { isActive: true },
      select: { slug: true, name: true },
    });
    const needed = games.filter((g) => BRAND_FOR_SLUG[g.slug]);
    if (!needed.length) { writeFileSync("/tmp/thumbs.json", JSON.stringify({ ok: false, reason: "no matching games" })); return; }

    // Accumulate brand thumbnails across pages: meta.brands is page-local.
    const thumb = new Map();
    let cursor = null;
    for (let page = 0; page < 25; page++) {
      const params = new URLSearchParams({ limit: "1000" });
      if (cursor) params.set("cursor", cursor);
      const r = await call({ path: `/api/v1/h2h/pricelists?${params.toString()}`, method: "GET", idempotent: true, operation: "thumbs" });
      if (!r.ok) { writeFileSync("/tmp/thumbs.json", JSON.stringify({ ok: false, error: r.error })); return; }
      for (const b of r.data?.meta?.brands ?? []) if (b?.thumbnail) thumb.set(b.name, b.thumbnail);
      const pg = r.data?.meta?.pagination;
      if (!pg?.has_more || !pg.next_cursor) break;
      cursor = pg.next_cursor;
      await new Promise((s) => setTimeout(s, 3300));
    }

    const out = { total: thumb.size, downloaded: [], skipped: [] };
    for (const g of needed) {
      const url = thumb.get(BRAND_FOR_SLUG[g.slug]);
      if (!url) { out.skipped.push({ slug: g.slug, reason: "thumbnail tidak ditemukan untuk brand" }); continue; }
      out.downloaded.push({ slug: g.slug, brand: BRAND_FOR_SLUG[g.slug], url });
    }
    writeFileSync("/tmp/thumbs.json", JSON.stringify(out, null, 2));
  });
}, 600000);

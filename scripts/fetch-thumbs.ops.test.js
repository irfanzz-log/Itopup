// Fetch brand thumbnails (CDN) for every active game, and download them into
// /public/icons/games so icons are local — the same policy as the existing ones
// (see the header comment in src/config/icons.js: never hotlink a brand CDN).
import { describe, it } from "vitest";
import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ICONS_DIR = path.resolve(process.cwd(), "public/icons/games");

// vitest's own loadEnv prefers .env.test (VITEST=true), which points at the
// throwaway local DB. This must run BEFORE src/lib/db.js is imported — db.js
// resolves DATABASE_URL at import time, so setting it afterwards is too late.
const ENV_FILE = (process.env.TARGET || "dev").toLowerCase() === "prod" ? ".env.prod" : ".env.dev";
for (const line of readFileSync(path.resolve(process.cwd(), ENV_FILE), "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

// Imported after the env is pinned to the target database.
const { prisma } = await import("../src/lib/db.js");
const { call } = await import("../src/providers/melostore/client.js");

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
  // ── Indonesia-region ladders added in the catalogue import ────────────────
  "8-ball-pool": "8 Ball Pool (ID)",
  "apex-legends-mobile": "Apex Legends Mobile (ID)",
  "arena-of-valor": "Arena of Valor (ID)",
  "battlenet-gift-card": "Battle.net Gift Cards (ID)",
  "dead-target": "Dead Target (Indonesia)",
  "dunk-city-dynasty": "Dunk City Dynasty (ID)",
  "eafc-mobile": "EAFC Mobile (ID)",
  "garena-shells": "Garena Shells Gift Card (ID)",
  "garena-undawn": "Garena Undawn (Indonesia)",
  "google-play": "Google Play (ID)",
  "honkai-star-rail": "Honkai: Star Rail (ID)",
  "league-of-legends": "League of Legends (ID)",
  "legends-of-runeterra": "Legends of Runeterra (Indonesia)",
  "point-blank": "Point Blank (ID)",
  "pokemon-unite": "Pokémon UNITE (ID)",
  "rainbow-six-mobile": "Rainbow Six Mobile (ID)",
  "razer-gold": "Razer Gold Indonesia",
  "tft-mobile": "TFT Mobile (ID)",
  "the-moonlit-oath": "The Moonlit Oath (ID)",
  "tiktok-gift-card": "TikTok Gift Card (ID)",
  "unipin-gift-card": "Unipin Gift Card (ID)",
  "valorant": "Valorant (Indonesia)",
  "wild-rift": "League of Legends: Wild Rift (ID)",
  "zenless-zone-zero": "Zenless Zone Zero (ID)",
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
    const extByMime = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg" };
    for (const g of needed) {
      const url = thumb.get(BRAND_FOR_SLUG[g.slug]);
      if (!url) { out.skipped.push({ slug: g.slug, reason: "thumbnail tidak ditemukan untuk brand" }); continue; }
      // Only fetch if the artwork is not already on disk: scanGameIcons is
      // first-seen-wins, so an existing file must never be overwritten.
      const existing = readdirSync(ICONS_DIR).find((f) => f.startsWith(g.slug + "."));
      if (existing) { out.skipped.push({ slug: g.slug, reason: `sudah ada: games/${existing}` }); continue; }
      const res = await fetch(url);
      if (!res.ok) { out.skipped.push({ slug: g.slug, reason: `HTTP ${res.status}` }); continue; }
      const ext = extByMime[String(res.headers.get("content-type") || "").split(";")[0].trim()] || "png";
      const file = path.join(ICONS_DIR, `${g.slug}.${ext}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) { out.skipped.push({ slug: g.slug, reason: `gambar terlalu kecil (${buf.length}B)` }); continue; }
      writeFileSync(file, buf);
      out.downloaded.push({ slug: g.slug, brand: BRAND_FOR_SLUG[g.slug], file: `games/${g.slug}.${ext}`, bytes: buf.length });
    }
    writeFileSync("/tmp/thumbs.json", JSON.stringify(out, null, 2));
  });
}, 600000);

// Operator script: rewrite `games.inputFields` for the email- and Riot-ID-shaped
// brands, so their checkout form stops asking for a username.
//
// WHY THIS IS NEEDED
//
//   The storefront reads `games.inputFields` from the DATABASE, not from
//   GAME_SEED (src/app/topup/[category]/[game]/page.jsx passes the row straight
//   into TopupForm). A config change alone therefore reaches dispatch but never
//   the form: the customer still saw a "Username" field whose pattern forbade
//   `@`, so a valid Google Play / Razer Gold address was rejected by our own
//   validation while the provider's inquiry form was asking for an email.
//
//   `prisma/seed.js` upserts these rows too, but a full re-seed also rewrites
//   products and variants. This touches only the twelve games below.
//
// FIELD SOURCE
//
//   Read off the provider's own inquiry forms in the live pricelist: form key
//   76af692ff8ef88e1146e67fe4602414f914dc912 is label "Email", type "email" and
//   covers Google Play, Razer Gold, Battle.net, Garena Shells, TikTok, Unipin
//   and Roblox; Riot's brands (Valorant, LoL, Wild Rift, TFT, Runeterra) use a
//   plain text field labelled "Riot ID".
//
//   GAME_SEED is the single source of truth for the shape of each field; this
//   script copies `inputFields` verbatim from it, so the two can never drift.
//
// RUN
//
//   npx vitest run --config vitest.sync.config.js \
//     scripts/update-game-input-fields.ops.test.js            # prod
//   FILL_TARGET=dev npx vitest run --config vitest.sync.config.js \
//     scripts/update-game-input-fields.ops.test.js            # dev
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { GAME_SEED } from "../src/config/games.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function forceEnv(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

const TARGET_FILE =
  { dev: ".env.dev", prod: ".env.prod" }[process.env.FILL_TARGET] ?? ".env.prod";

// slug → the single field key the game must now collect.
const CHANGED = [
  ["battlenet-gift-card", "email"],
  ["garena-shells", "email"],
  ["google-play", "email"],
  ["razer-gold", "email"],
  ["tiktok-gift-card", "email"],
  ["unipin-gift-card", "email"],
  // "Roblox (Via Login)" is the brand the pricelist sells Robux under; its form
  // is Login + Password, the same shape as eFootball.
  ["roblox", "gameLogin"],
  ["league-of-legends", "riotId"],
  ["legends-of-runeterra", "riotId"],
  ["tft-mobile", "riotId"],
  ["valorant", "riotId"],
  ["wild-rift", "riotId"],
];

const SLUGS = CHANGED.map(([slug]) => slug);

function seedFields(slug) {
  return GAME_SEED.find((g) => g.slug === slug)?.inputFields;
}

describe("games.inputFields backfill", () => {
  it("rewrites the email and Riot ID games from GAME_SEED", async () => {
    forceEnv(TARGET_FILE);

    // The pooler in DATABASE_URL refuses Prisma's transaction-mode DDL and can
    // time out; DIRECT_URL is the same database over the direct connection.
    const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error(`DATABASE_URL tidak terbaca dari ${TARGET_FILE}.`);

    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

    const before = await prisma.game.findMany({
      where: { slug: { in: SLUGS } },
      select: { slug: true, inputFields: true },
    });
    const stale = before.filter(
      (g) => JSON.stringify(g.inputFields) !== JSON.stringify(seedFields(g.slug)),
    );
    console.log(`target: ${TARGET_FILE} · games needing an update: ${stale.length} of ${CHANGED.length}`);

    for (const [slug] of CHANGED) {
      const fields = seedFields(slug);
      if (!fields) throw new Error(`GAME_SEED has no entry for "${slug}".`);
      await prisma.game.update({ where: { slug }, data: { inputFields: fields } });
    }

    // Verified against the database, not against the write request: the row is
    // what the storefront reads, and a driver that reordered the array or
    // dropped a key would leave the form and the config silently disagreeing.
    const after = await prisma.game.findMany({
      where: { slug: { in: SLUGS } },
      select: { slug: true, inputFields: true },
    });
    expect(after).toHaveLength(CHANGED.length);
    for (const [slug, expectedKey] of CHANGED) {
      const row = after.find((g) => g.slug === slug);
      expect(row?.inputFields.map((f) => f.key), `game ${slug}`).toEqual([
        expectedKey === "gameLogin" ? "gameLogin" : expectedKey,
        ...(expectedKey === "gameLogin" ? ["gamePassword"] : []),
      ]);
      expect(row?.inputFields[0].label, `game ${slug}`).toBe(
        expectedKey === "email"
          ? "Email"
          : expectedKey === "gameLogin"
            ? "Login Akun Game"
            : "Riot ID",
      );
      expect(row?.inputFields[0].pattern, `game ${slug}`).toBeTruthy();
    }

    // No game outside this list may have drifted to an email/Riot field either;
    // those were not read off the provider's forms and changing them would be a
    // guess.
    const others = await prisma.game.findMany({
      where: { slug: { notIn: SLUGS } },
      select: { slug: true, inputFields: true },
    });
    const untouchedEmail = others.filter((g) => g.inputFields?.[0]?.key === "email");
    expect(untouchedEmail, "games not in the list must not gain an email field").toEqual([]);

    await prisma.$disconnect();
  });
});

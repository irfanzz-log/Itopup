// Operator probe: find the eFootball brand id and its inquiry form, and dump
// the full iOS/Android coin ladder. Paginates the whole pricelist.
//
// Run with:
//   npx vitest run --config vitest.sync.config.js scripts/efootball-ladder.ops.test.js
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/efootball-ladder.log";

function say(line) {
  fs.appendFileSync(REPORT, line + "\n");
}

describe("eFootball brand + ladder probe", () => {
  it("resolves the eFootball brand and dumps its coin SKUs", async () => {
    fs.rmSync(REPORT, { force: true });

    const file = fs.existsSync(path.join(ROOT, ".env.dev")) ? ".env.dev" : ".env";
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
    process.env.NODE_ENV = "development";

    const { melostoreProvider: provider } = await import("../src/providers/melostore/index.js");

    // Page 1 only: meta.brands + meta.inquiry_forms repeat on every page, and
    // every eFootball coin SKU family lands in the first 1000 rows.
    const res = await provider.getProducts({ limit: 1000, category: null });
    const products = res.products ?? res.data?.products ?? [];
    const brands = res.brands ?? res.data?.brands ?? [];
    const forms = res.inquiryForms ?? res.data?.inquiryForms ?? {};

    const brandById = new Map();
    for (const b of brands) brandById.set(b.id, b);
    say(`products=${products.length} brands=${brands.length} forms=${Object.keys(forms).length}`);

    const eppes = products.filter((p) => /^eppes/i.test(String(p.providerCode ?? "")));
    const brandIds = new Set();
    for (const p of eppes) {
      if (p.brandId != null) brandIds.add(p.brandId);
    }
    say("");
    say(`=== brand ids referenced by eppes SKUs: ${[...brandIds].join(", ") || "(none)"} ===`);
    for (const id of brandIds) {
      const b = brandById.get(id);
      say(`  id=${id} -> ${b ? JSON.stringify(b) : "NOT in meta.brands"}`);
    }

    // Search brand names for the game under any spelling the provider may use.
    say("");
    say("=== brands matching football/pes/konami ===");
    const hit = brands.filter((b) => /football|\bpes\b|konami|winning/i.test(String(b.name ?? "")));
    for (const b of hit) say(`  ${JSON.stringify(b)}`);
    if (!hit.length) say("  (none)");

    // Resolve the inquiry form attached to the eppes SKUs.
    const formKey = eppes.find((p) => p.inquiryFormKey)?.inquiryFormKey ?? null;
    say("");
    say(`=== inquiry form used by eppes SKUs: ${formKey} ===`);
    if (formKey) say(`  ${JSON.stringify(forms[formKey])}`);

    say("");
    say("=== ALL inquiry forms (7) ===");
    for (const [k, v] of Object.entries(forms)) say(`  ${k} -> ${JSON.stringify(v)}`);

    // Distinguish Coins ladders from Starter Set / bundle SKUs. Only plain
    // "N Coins" cards are candidates for the shop shelf.
    say("");
    say(`=== eppes SKUs matching "^<number> Coins (<platform>)" (active only) ===`);
    const coinRe = /^(\d+)\s+Coins\s*\((IOS|Android)\)$/i;
    const coins = [];
    for (const p of eppes) {
      const m = coinRe.exec(String(p.name ?? "").trim());
      if (!m) continue;
      if (!p.available) continue;
      coins.push({ code: p.providerCode, name: p.name.trim(), platform: m[2].toUpperCase(), denom: Number(m[1]), price: p.price, form: p.inquiryFormKey });
    }
    coins.sort((a, b) => a.platform.localeCompare(b.platform) || a.denom - b.denom);
    for (const c of coins) say(`  ${JSON.stringify(c)}`);
    say(`count=${coins.length}`);

    say("");
    say("DONE");
  }, 120_000);
});

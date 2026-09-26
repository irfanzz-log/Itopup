import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script — read-only against the provider, writes NOTHING to the DB.
//   npx vitest run --config vitest.sync.config.js scripts/live-catalog.ops.test.js
//
// Dumps the LIVE pricelist rows for the brands we are about to link, so the
// mapping table is generated from the provider's own data (sku_code, price,
// status, server_code, inquiry_form_key) rather than from a spreadsheet snapshot.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/live-catalog.log";

const say = (line = "") => fs.appendFileSync(REPORT, line + "\n");

function forceEnv() {
  const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
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
}

describe("live catalog", () => {
  it("dumps target brands from the live pricelist", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    const { melostoreProvider } = await import("../src/providers/melostore/index.js");

    const wanted = new Set([
      "eFootball (PES)",
      "Telkomsel", "Indosat", "XL", "Axis", "3", "3 Data Happy", "Smartfren", "by.u",
      "DANA",
      "Mobile Legends (ID)",
      "Free Fire (ID)",
      "PUBG Mobile (ID)", "PUBG Mobile (Global)",
      "Call of Duty Mobile - Activision (CA)",
      "Roblox (Via Login)",
      "Genshin Impact (ID)",
    ]);

    // Categories, so we can see whether any e-wallet brand other than DANA exists.
    const cats = await melostoreProvider.getCategories({});
    say("=== CATEGORIES ===");
    say(JSON.stringify(cats, null, 2).slice(0, 3000));

    const res = await melostoreProvider.getProducts({});
    if (!res.ok) {
      say(`FETCH FAILED: ${JSON.stringify(res.error)}`);
      return;
    }

    const { products, brands, inquiryForms } = res.data;
    say("");
    say(`fetched=${products.length} brands=${brands.length}`);

    const brandById = new Map(brands.map((b) => [b.id, b]));

    say("");
    say("=== INQUIRY FORMS ===");
    for (const [k, v] of Object.entries(inquiryForms)) {
      say(`  ${k}: ${JSON.stringify(v)}`);
    }

    // Every brand name that mentions a wallet-ish word, to prove/disprove the
    // "provider only sells DANA" finding on the LIVE catalogue.
    say("");
    say("=== brands matching wallet keywords (live) ===");
    const kw = ["ovo", "gopay", "go-pay", "shopee", "dana", "linkaja", "jenius", "shopeepay", "wallet", "sakuku", "flazz"];
    const seenBrand = new Map();
    for (const p of products) {
      const name = p.brandId !== null ? brandById.get(p.brandId)?.name : null;
      if (!name) continue;
      if (kw.some((k) => name.toLowerCase().includes(k))) {
        seenBrand.set(name, (seenBrand.get(name) ?? 0) + 1);
      }
    }
    for (const [n, c] of [...seenBrand.entries()].sort()) say(`  ${n}: ${c}`);

    const byBrand = new Map();
    for (const p of products) {
      const name = p.brandId !== null ? brandById.get(p.brandId)?.name : null;
      if (!name || !wanted.has(name)) continue;
      if (!byBrand.has(name)) byBrand.set(name, []);
      byBrand.get(name).push(p);
    }

    for (const name of [...byBrand.keys()].sort()) {
      const rows = byBrand.get(name);
      say("");
      say(`=== ${name} (${rows.length}) ===`);
      for (const p of rows.sort((a, b) => a.providerCode.localeCompare(b.providerCode))) {
        say(
          `${p.providerCode}\t${p.price}\t${p.available ? "active" : "inactive"}\t` +
            `srv=${p.serverCode ?? "-"}\tform=${p.inquiryFormKey ?? "-"}\t${p.name}`
        );
      }
    }

    const missing = [...wanted].filter((w) => !byBrand.has(w));
    say("");
    say(`=== NOT FOUND IN LIVE CATALOGUE: ${JSON.stringify(missing)} ===`);
    say("DONE");
  }, 900_000);
});

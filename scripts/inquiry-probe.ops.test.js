import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script — run with:
//   npx vitest run --config vitest.sync.config.js scripts/inquiry-probe.ops.test.js
//
// It reads the provider's pricelist through the REAL adapter and prints the
// `inquiry_forms` for the brands we are about to link, so the target field
// (userId vs phoneNumber vs email) is taken from the provider and not guessed.
// Nothing is written to the database.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/inquiry-report.log";

function say(line) {
  fs.appendFileSync(REPORT, line + "\n");
}

/** Force the .env values BEFORE anything imports src/lib/db.js or env.js. */
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

describe("provider inquiry forms", () => {
  it("prints the required target field per brand", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    const { MelostoreProvider } = await import("../src/providers/melostore/index.js");
    const provider = new MelostoreProvider();

    const brands = [
      "eFootball (PES)",
      "Telkomsel",
      "Indosat",
      "XL",
      "Axis",
      "3",
      "Smartfren",
      "by.u",
      "DANA",
      "Mobile Legends (ID)",
      "Free Fire (ID)",
      "Roblox (Via Login)",
      "Call of Duty Mobile - Activision (CA)",
    ];

    say(`base=${provider.baseUrl ?? "?"}`);
    const res = await provider.fetchPricelist({ limit: 1000, page: 1 });
    const products = res.products ?? res;
    const forms = res.inquiryForms ?? [];
    say(`fetched=${products.length} inquiryForms=${forms.length}`);

    say("");
    say("=== inquiry_forms as published ===");
    for (const f of forms) {
      say(`  ${JSON.stringify(f)}`);
    }

    for (const brand of brands) {
      const rows = products.filter((p) => p.brandName === brand || p.brand === brand);
      const anyRow = rows[0];
      say("");
      say(`=== ${brand} (rows in page 1: ${rows.length}) ===`);
      if (anyRow) {
        say(`  sample: ${JSON.stringify({
          providerCode: anyRow.providerCode,
          name: anyRow.name,
          inquiryFormKey: anyRow.inquiryFormKey,
          serverCode: anyRow.serverCode,
          category: anyRow.category,
          available: anyRow.available,
        })}`);
      }
    }

    say("");
    say("DONE");
  }, 120_000);
});

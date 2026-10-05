// Operator probe: what inquiry fields does Melostore actually publish for the
// eFootball brand, and is there a per-platform (iOS/Android) coin ladder?
//
// Run with:
//   npx vitest run --config vitest.sync.config.js scripts/efootball-form.ops.test.js
//
// Reads the local database only (catalogMeta cached by a previous sync).
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/efootball-form.log";

function say(line) {
  fs.appendFileSync(REPORT, line + "\n");
}

describe("eFootball inquiry form (cached catalog meta)", () => {
  it("prints the eFootball brand's inquiry form fields", async () => {
    fs.rmSync(REPORT, { force: true });

    // This repo keeps live env in .env.dev. loadEnv()/vitest would otherwise
    // point at the test database.
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

    const { PrismaClient } = await import("../generated/prisma/client.ts");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

    const providers = await prisma.provider.findMany({
      where: { code: "melostore" },
      select: { id: true, code: true, catalogMeta: true, lastSyncAt: true },
    });

    say(`providers=${providers.length}`);
    for (const p of providers) {
      say(`lastSyncAt=${p.lastSyncAt?.toISOString() ?? "never"}`);
      const meta = p.catalogMeta ?? {};
      const forms = meta.inquiryForms ?? {};
      say(`inquiryForms keys=${Object.keys(forms).length}`);
      for (const [key, value] of Object.entries(forms)) {
        say(`  ${key} -> ${JSON.stringify(value)}`);
      }
      const brands = meta.brands ?? [];
      const efoot = brands.filter((b) => /efootball|pes|football/i.test(String(b.name ?? "")));
      say("");
      say(`=== football-ish brands (${efoot.length}) ===`);
      for (const b of efoot) say(`  ${JSON.stringify(b)}`);
    }

    await prisma.$disconnect();
    say("");
    say("DONE");
  }, 120_000);
});

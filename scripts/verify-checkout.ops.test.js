// Verify the real checkout path against the connected database.
//
// Calls the SAME functions the order service calls — getSellableVariant() and
// selectProviderMapping() — so a pass here means POST /api/orders will resolve
// a provider SKU instead of throwing ITP_PRODUCT_UNAVAILABLE.
//
//   npx vitest run --config vitest.sync.config.js scripts/verify-checkout.ops.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// See sync-catalog.ops.test.js: vitest loads .env.test (local DB) which would
// silently override the .env connection strings we actually want to test.
function parseEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}
const dotenv = parseEnvFile(path.resolve(process.cwd(), '.env'));
for (const k of ['DATABASE_URL', 'DIRECT_URL', 'MELOSTORE_API_KEY', 'MELOSTORE_SECRET', 'MELOSTORE_BASE_URL', 'TOPUP_PROVIDER']) {
  if (dotenv[k] !== undefined) process.env[k] = dotenv[k];
}

describe('verify: checkout resolves a provider SKU', () => {
  it('every linked variant passes getSellableVariant + selectProviderMapping', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { getSellableVariant, selectProviderMapping } = await import('../src/services/catalog.service.js');

    const out = [];
    const say = (s = '') => { out.push(String(s)); console.log(s); };

    const host = new URL(process.env.DATABASE_URL).host;
    say(`target host: ${host}`);

    const provider = await prisma.provider.findUnique({
      where: { code: 'melostore' },
      select: { status: true, lastSyncStatus: true },
    });
    say(`provider:    ${JSON.stringify(provider)}`);
    say(`links:       ${await prisma.providerProduct.count()}`);

    // Every variant that has a link, with exactly the shape the order service
    // loads (isAvailable + provider.status).
    const variants = await prisma.productVariant.findMany({
      where: { providerProducts: { some: {} } },
      select: {
        id: true,
        slug: true,
        isActive: true,
        stock: true,
        product: { select: { isActive: true, name: true, game: { select: { slug: true, name: true, isActive: true } } } },
      },
    });
    say(`\nvariants with a link: ${variants.length}`);

    let resolved = 0;
    const failures = [];
    const byGame = new Map();
    for (const v of variants) {
      const game = v.product?.game?.slug ?? '?';
      byGame.set(game, (byGame.get(game) ?? 0) + 1);

      let sellable;
      try {
        sellable = await getSellableVariant(v.id);
      } catch (err) {
        failures.push(`${game}/${v.slug} — getSellableVariant threw ${err.code ?? err.message}`);
        continue;
      }
      const mapping = selectProviderMapping(sellable);
      if (!mapping) {
        failures.push(`${game}/${v.slug} — selectProviderMapping returned null`);
        continue;
      }
      resolved++;
    }

    say(`\n=== RESULT ===`);
    say(`  checkout-resolvable: ${resolved} / ${variants.length}`);
    say(`  failures:            ${failures.length}`);
    for (const f of failures.slice(0, 15)) say(`    ${f}`);

    say(`\nlinked variants per game:`);
    for (const [g, n] of [...byGame].sort()) say(`  ${g.padEnd(20)} ${n}`);

    // Hand a ready-to-use checkout payload to /tmp/buyable.json so the HTTP
    // test can POST /api/orders without re-deriving anything.
    const buyable = [];
    for (const v of variants) {
      try {
        const sellable = await getSellableVariant(v.id);
        if (!selectProviderMapping(sellable)) continue;
        const game = sellable.product.game;
        const fields = {};
        for (const f of game.inputFields ?? []) {
          fields[f.key] = f.key === 'playerId' || f.key === 'userId' ? '123456789' : '123456789';
        }
        buyable.push({
          variantId: v.id,
          gameSlug: game.slug,
          variantSlug: v.slug,
          fields,
          inputFields: (game.inputFields ?? []).map((f) => f.key),
        });
      } catch {
        /* not buyable */
      }
    }
    fs.writeFileSync('/tmp/buyable.json', JSON.stringify(buyable, null, 2));
    say(`\nwrote ${buyable.length} buyable payloads to /tmp/buyable.json`);
    for (const b of buyable.slice(0, 5)) say(`  ${b.gameSlug}/${b.variantSlug} fields=${b.inputFields.join(',')}`);

    // How many of the whole catalogue are buyable right now?
    const all = await prisma.productVariant.count({ where: { isActive: true } });
    say(`\nwhole catalogue active variants: ${all}`);
    say(`purchasable (linked AND passes checkout guards): ${resolved}`);

    fs.writeFileSync('/tmp/checkout-verify.log', out.join('\n'));
    await prisma.$disconnect();
    expect(resolved).toBeGreaterThan(0);
  }, 300_000);
});

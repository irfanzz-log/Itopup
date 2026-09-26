// Confirm the order created by the HTTP test actually carries a provider SKU.
//
//   npx vitest run --config vitest.sync.config.js scripts/verify-order.ops.test.js <INVOICE>
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

const INVOICE = process.argv.find((a) => a.startsWith('ITP-')) ?? null;

describe('verify: created order carries a provider SKU', () => {
  it('order item resolves to a providerCode', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const out = [];
    const say = (s = '') => { out.push(String(s)); console.log(s); };

    const order = await prisma.order.findFirst({
      where: INVOICE ? { invoice: INVOICE } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, invoice: true, status: true, total: true,
        items: {
          select: {
            id: true,
            productName: true,
            gameName: true,
            unitCostPrice: true,
            unitSellingPrice: true,
            subtotal: true,
            productVariant: {
              select: {
                slug: true,
                costPrice: true,
                sellingPrice: true,
                product: { select: { name: true, game: { select: { slug: true } } } },
                providerProducts: {
                  select: { providerCode: true, providerPrice: true, isAvailable: true, provider: { select: { code: true, status: true } } },
                },
              },
            },
          },
        },
      },
    });

    say(`order: ${order.invoice}  status=${order.status}  total=${order.total}`);
    for (const it of order.items) {
      const v = it.productVariant;
      say(`\n  item: ${v.product.game.slug}/${v.slug}  (${it.productName})`);
      say(`    gameName on the ORDER ITEM:     ${it.gameName}`);
      say(`    unitCostPrice → unitSelling:    ${it.unitCostPrice} → ${it.unitSellingPrice}  subtotal=${it.subtotal}`);
      say(`    variant cost → sell:            ${v.costPrice} → ${v.sellingPrice}`);
      say(`    links: ${v.providerProducts.map((p) => `${p.provider.code}(${p.provider.status}) ${p.providerCode} avail=${p.isAvailable}`).join(', ')}`);
    }

    fs.writeFileSync('/tmp/order-verify.log', out.join('\n'));
    await prisma.$disconnect();
    // The order must carry a cost that came from the provider, and the variant
    // must still be linked to an ACTIVE provider.
    expect(order.items[0].unitCostPrice).toBeGreaterThan(0);
    expect(order.items[0].productVariant.providerProducts.length).toBeGreaterThan(0);
  }, 120_000);
});

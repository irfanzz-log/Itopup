// Remove the accounts and orders created by the HTTP checkout test.
// Deletes only addresses matching the throwaway pattern used by the test.
//
//   npx vitest run --config vitest.sync.config.js scripts/cleanup-testdata.ops.test.js
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
for (const k of ['DATABASE_URL', 'DIRECT_URL', 'TOPUP_PROVIDER']) {
  if (dotenv[k] !== undefined) process.env[k] = dotenv[k];
}

describe('cleanup: throwaway checkout-test data', () => {
  it('removes test accounts and their orders', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const out = [];
    const say = (s = '') => { out.push(String(s)); console.log(s); };

    say(`target host: ${new URL(process.env.DATABASE_URL).host}`);

    // Match only the throwaway addresses the HTTP test registered.
    const victims = await prisma.user.findMany({
      where: { email: { endsWith: '@test.local' } },
      select: { id: true, email: true, _count: { select: { orders: true } } },
    });
    say(`\ntest accounts found: ${victims.length}`);
    for (const v of victims) say(`  ${v.email}  orders=${v._count.orders}`);

    if (victims.length === 0) {
      say('nothing to clean');
      fs.writeFileSync('/tmp/cleanup.log', out.join('\n'));
      await prisma.$disconnect();
      return;
    }

    const ids = victims.map((v) => v.id);
    // OrderItem cascades from Order, and Order cascades from User; delete the
    // orders explicitly anyway so the counts we report are real, not assumed.
    const orders = await prisma.order.deleteMany({ where: { userId: { in: ids } } });
    const users = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    say(`\ndeleted: ${orders.count} orders, ${users.count} users`);

    // Prove the catalogue and provider links were untouched.
    const pp = await prisma.providerProduct.count();
    const variants = await prisma.productVariant.count();
    say(`\nuntouched: provider_products=${pp}  variants=${variants}`);
    say(`remaining users: ${await prisma.user.count()}`);

    fs.writeFileSync('/tmp/cleanup.log', out.join('\n'));
    await prisma.$disconnect();
    expect(users.count).toBe(victims.length);
  }, 180_000);
});

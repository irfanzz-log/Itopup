// Refined matcher: match on the provider's product NAME (which states the
// delivered amount) instead of the SKU number, because several brands encode
// bonuses in the SKU (codmacca88c = "80 + 8 CP") or thousands (dnt10ko = Rp 10.000).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { products } = JSON.parse(readFileSync('/tmp/melo-pricelist.json', 'utf8'));

const sql = `SELECT g.slug || '|' || pv.slug || '|' || COALESCE(pv.denomination, 0) || '|' || pv.name
             FROM product_variants pv
             JOIN products p ON p.id = pv."productId"
             JOIN games g ON g.id = p."gameId"
             ORDER BY g.slug, pv.slug;`;
const ours = execFileSync('psql', ['postgresql://irfanzzs@localhost:5432/itopup', '-At', '-c', sql], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)
  .map((r) => { const [game, variant, denom, name] = r.split('|'); return { game, variant, denom: Number(denom), name }; });

// Which SKU prefix belongs to which of our games (verified against the snapshot).
const PREFIX = {
  'mobile-legends': /^mlid/i,
  'free-fire': /^ffid/i,
  'pubg-mobile': /^pubgmgl/i,
  codm: /^codmacca/i,
  roblox: /^rob\d+ro/i,
  'genshin-impact': /^giavlavl/i,
  dana: /^dnt\d+ko/i,
};

// Extract the "delivered amount" from a provider product name.
// Handles "28 Diamonds", "Rp. 10.000", "80 + 8 CP", "8100 Unknown Cash".
function amountFromName(name) {
  const s = String(name);
  // "80 + 8 CP" → base + bonus = 88
  const bonus = s.match(/^(\d[\d.,]*)\s*\+\s*(\d[\d.,]*)/);
  if (bonus) {
    const a = Number(bonus[1].replace(/[.,]/g, ''));
    const b = Number(bonus[2].replace(/[.,]/g, ''));
    return { total: a + b, base: a, bonus: b };
  }
  const m = s.match(/(\d[\d.,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return { total: n, base: n, bonus: 0 };
}

const matched = [];
const unmatched = [];

for (const v of ours) {
  const re = PREFIX[v.game];
  if (!re) { unmatched.push({ ...v, why: 'no prefix rule' }); continue; }

  const pool = products.filter((p) => re.test(String(p.sku_code)));
  if (!pool.length) { unmatched.push({ ...v, why: 'no SKUs for this game' }); continue; }

  // DANA: our denom 10000 == provider name "Rp. 10.000"
  const target = v.denom;
  const cands = pool.filter((p) => {
    const a = amountFromName(p.name);
    if (!a) return false;
    return a.total === target || a.base === target;
  });

  if (!cands.length) { unmatched.push({ ...v, why: `no SKU delivers ${target}` }); continue; }

  // Prefer active, then the one whose SKU has no bonus (exact match), then cheapest.
  const pick =
    cands.find((c) => c.status === 'active' && amountFromName(c.name).bonus === 0) ??
    cands.find((c) => c.status === 'active') ??
    cands[0];

  const a = amountFromName(pick.name);
  matched.push({ ...v, sku: pick.sku_code, price: pick.price, status: pick.status, pname: pick.name, alts: cands.length, exact: a.bonus === 0 });
}

console.log(`our variants: ${ours.length}   matched: ${matched.length}   unmatched: ${unmatched.length}\n`);
console.log('=== MATCHED ===');
for (const m of matched) {
  console.log(`  ${m.game.padEnd(16)} ${m.variant.padEnd(9)} ${String(m.denom).padStart(8)}  ->  ${m.sku.padEnd(22)} Rp${String(m.price).padStart(9)} ${m.status.padEnd(13)} "${m.pname}"${m.exact ? '' : '  (BONUS SKU)'}${m.alts > 1 ? ` [${m.alts} cands]` : ''}`);
}
console.log('\n=== UNMATCHED ===');
for (const u of unmatched) console.log(`  ${u.game.padEnd(16)} ${u.variant.padEnd(9)} ${String(u.denom).padStart(8)}  ${u.why}`);

// Also report: which provider SKUs exist that we DON'T sell (upsell opportunity)
console.log('\n=== PROVIDER SKUs WITH NO VARIANT OF OURS (sample) ===');
let extra = 0;
for (const [game, re] of Object.entries(PREFIX)) {
  const pool = products.filter((p) => re.test(String(p.sku_code)) && p.status === 'active');
  const usedSkus = new Set(matched.filter((m) => m.game === game).map((m) => m.sku));
  const spare = pool.filter((p) => !usedSkus.has(p.sku_code));
  extra += spare.length;
  console.log(`  ${game.padEnd(16)} ${pool.length} active provider SKUs, ${spare.length} not linked`);
}
console.log(`  TOTAL unlinked active SKUs: ${extra}`);

const body = matched.map((m) => `    "${m.sku}": { gameSlug: "${m.game}", variantSlug: "${m.variant}" }, // ${m.pname}`).join('\n');
writeFileSync('/tmp/mapping-entries.txt', body + '\n');
console.log('\nwritten -> /tmp/mapping-entries.txt');

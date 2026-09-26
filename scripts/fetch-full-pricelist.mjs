// Fetch the FULL pricelist with correct pacing (rate limit is per REQUEST, not
// per row — verified: limit=1000 costs 1 unit). ~10k products at limit=1000 is
// ~11 requests, comfortably inside the 20/min sub-bucket.
//
// Writes the raw result to /tmp/melo-pricelist.json. READ-ONLY: no DB writes.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { loadCredentials } from '../src/providers/melostore/client.js';
import { authorizeRequest } from '../src/providers/melostore/signature.js';

const creds = loadCredentials();
const base = creds.baseUrl.replace(/\/+$/, '');

const PAGE_SIZE = 1000;
const PACE_MS = 3500; // 20/min bucket => one request every 3s is safe

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(cursor) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  const url = `${base}/api/v1/h2h/pricelists?${params.toString()}`;
  const auth = authorizeRequest({ method: 'GET', payload: null });

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', ...auth.headers },
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  });
  const text = await resp.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: resp.status, body, headers: resp.headers, text };
}

const products = [];
let brands = [];
let inquiryForms = {};
let cursor = null;
let pages = 0;
let total = null;

for (let i = 0; i < 60; i++) {
  const r = await fetchPage(cursor);
  const remaining = r.headers.get('x-ratelimit-remaining');
  const retryAfter = r.headers.get('retry-after');

  if (r.status === 429) {
    console.log(`page ${i + 1}: 429, retry-after=${retryAfter} — sleeping ${retryAfter ?? 60}s`);
    await sleep(((Number(retryAfter) || 60) + 2) * 1000);
    continue; // retry same page
  }
  if (r.status !== 200 || !r.body?.success) {
    console.log(`page ${i + 1}: FAILED status=${r.status} body=${r.text.slice(0, 300)}`);
    break;
  }

  const entries = r.body.data ?? [];
  const meta = r.body.meta ?? {};
  const pag = meta.pagination ?? {};
  products.push(...entries);
  if (Array.isArray(meta.brands) && meta.brands.length) brands = meta.brands;
  if (meta.inquiry_forms && Object.keys(meta.inquiry_forms).length) inquiryForms = meta.inquiry_forms;
  if (total === null && pag.total != null) total = pag.total;
  pages++;

  console.log(
    `page ${String(i + 1).padStart(2)}: ${String(entries.length).padStart(4)} rows  ` +
    `cum=${String(products.length).padStart(5)}  rl-remaining=${remaining ?? '-'}  ` +
    `has_more=${pag.has_more}  next=${pag.next_cursor ? String(pag.next_cursor).slice(0, 12) + '…' : '-'}`
  );

  if (!pag.has_more || !pag.next_cursor) break;
  cursor = pag.next_cursor;
  await sleep(PACE_MS);
}

console.log(`\nTOTAL: ${products.length} products over ${pages} pages (provider reports total=${total})`);
console.log(`brands: ${brands.length}, inquiryForms: ${Object.keys(inquiryForms).length}`);

writeFileSync('/tmp/melo-pricelist.json', JSON.stringify({ products, brands, inquiryForms, pages, total }, null, 2));
console.log('saved -> /tmp/melo-pricelist.json');

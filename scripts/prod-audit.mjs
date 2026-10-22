// ============================================================================
// PRODUCTION READ-ONLY AUDIT — answers "apakah transaksi benar?" without
// touching anything.
//
// WHAT THIS SCRIPT NEVER DOES:
//   * no INSERT/UPDATE/DELETE/TRUNCATE
//   * no createOrder, no dispatchOrder, no Midtrans call, no Melostore call
//   * not loaded through tests/setup.js (that file TRUNCATEs every table)
//
// It reads .env.prod directly and opens a plain `pg` Pool with the SAME options
// src/lib/db.js uses (transaction-mode pooler → prepare: false), so what we see
// here is exactly what the running app sees.
//
// Run:  node scripts/prod-audit.mjs
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Pool } from "pg";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

// ── Load .env.prod the same way src/lib/env.js would for NODE_ENV=production ──
function loadEnvFile(file) {
  const out = {};
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const prodEnv = loadEnvFile(path.resolve(ROOT, ".env"));
if (Object.keys(prodEnv).length === 0) {
  console.error("FATAL: .env.prod is missing or empty.");
  process.exit(1);
}
// Shell env wins (same precedence as dotenv `override: false`), but refuse a
// mismatched DATABASE_URL so a stale export cannot silently re-target this.
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== prodEnv.DATABASE_URL) {
  console.error("FATAL: shell DATABASE_URL differs from .env.prod. Unset it or use the prod file.");
  process.exit(1);
}
for (const [k, v] of Object.entries(prodEnv)) {
  process.env[k] ??= v;
}

const masked = String(process.env.DATABASE_URL).replace(/:[^:@/]+@/, ":***@");
console.log(`\n[prod-audit] target: ${masked}`);
console.log(`[prod-audit] NODE_ENV=${process.env.NODE_ENV}  APP_URL=${process.env.NEXT_PUBLIC_APP_URL}`);
console.log(
  `[prod-audit] MIDTRANS_IS_PRODUCTION=${process.env.MIDTRANS_IS_PRODUCTION}  MELOSTORE_SANDBOX=${process.env.MELOSTORE_SANDBOX}`
);

const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
  // Direct URL is the session-mode port (5432), so prepared statements are fine.
  // If only the pooler URL is available it is transaction mode → prepare: false.
  prepare: !/pgbouncer=true/i.test(process.env.DIRECT_URL ?? process.env.DATABASE_URL),
});

async function q(text) {
  return pool.query(text);
}

async function main() {
  const report = [];
  const say = (s = "") => {
    report.push(String(s));
    console.log(s);
  };

  say("=== CONNECTION ===");
  const dbName = (await q("select current_database(), version()")).rows[0];
  say(`database: ${dbName.current_database}`);
  say(`version:  ${dbName.version.split(" ").slice(0, 2).join(" ")}`);

  // ── Table inventory: prove we are looking at a real Itopup schema ──
  const tables = (
    await q(
      `select tablename from pg_tables where schemaname='public' order by tablename`
    )
  ).rows.map((r) => r.tablename);
  say(`tables (${tables.length}): ${tables.join(", ")}`);

  // ── Row counts, no secrets ──
  say("\n=== ROW COUNTS ===");
  const counts = await q(
    `select 'users' t, count(*) n from users
     union all select 'orders', count(*) from orders
     union all select 'order_items', count(*) from order_items
     union all select 'payments', count(*) from payments
     union all select 'games', count(*) from games
     union all select 'products', count(*) from products
     union all select 'product_variants', count(*) from product_variants
     union all select 'providers', count(*) from providers
     union all select 'provider_products', count(*) from provider_products
     union all select 'transaction_logs', count(*) from transaction_logs
     union all select 'promos', count(*) from promos
     union all select 'voucher_claims', count(*) from voucher_claims
     union all select 'game_credentials', count(*) from game_credentials`
  );
  for (const r of counts.rows) say(`  ${r.t.padEnd(20)} ${r.n}`);

  // ── Provider state: is the top-up provider live and linked? ──
  say("\n=== PROVIDERS ===");
  const providers = await q(
    `select code, name, status, last_sync_status, last_sync_at, balance, base_url
       from providers order by priority`
  );
  for (const p of providers.rows) {
    say(
      `  ${p.code} | ${p.name} | status=${p.status} lastSync=${p.last_sync_status ?? "(none)"} at=${p.last_sync_at?.toISOString?.() ?? "-"} balance=${p.balance ?? "-"}`
    );
    say(`      base_url=${p.base_url ?? "-"}`);
  }

  const linkStats = await q(
    `select
        count(*) total,
        count(*) filter (where is_available) available,
        count(*) filter (where provider_price is not null and provider_price > 0) priced
       from provider_products`
  );
  say(
    `\nprovider_products: total=${linkStats.rows[0].total} available=${linkStats.rows[0].available} priced=${linkStats.rows[0].priced}`
  );

  // ── Order status distribution ──
  say("\n=== ORDER STATUS DISTRIBUTION ===");
  const dist = await q(`select status, count(*) n, sum(total) total from orders group by status order by status`);
  for (const r of dist.rows) say(`  ${String(r.status).padEnd(24)} n=${r.n}  total=${r.total}`);

  // ── Payment status distribution ──
  say("\n=== PAYMENT STATUS DISTRIBUTION ===");
  const pdist = await q(
    `select status, count(*) n, sum(amount) amount from payments group by status order by status`
  );
  for (const r of pdist.rows) say(`  ${String(r.status).padEnd(24)} n=${r.n}  amount=${r.amount}`);

  // ── CONSISTENCY CHECK 1: order vs payment status must tell one story ──
  say("\n=== CONSISTENCY: order.status vs payment.status ===");
  const mismatch = await q(
    `select o.id, o.invoice, o.status order_status, p.status payment_status, o.total,
            o.created_at
       from orders o join payments p on p.order_id = o.id
      where (o.status = 'PAID' and p.status not in ('PAID','SETTLED','REFUNDED'))
         or (o.status = 'SUCCESS' and p.status not in ('PAID','SETTLED'))
         or (p.status in ('PAID','SETTLED') and o.status in ('PENDING_PAYMENT','PAYMENT_PROCESSING','EXPIRED','CANCELLED'))
      order by o.created_at desc
      limit 20`
  );
  say(`  suspicious pairs: ${mismatch.rows.length}`);
  for (const r of mismatch.rows) {
    say(
      `    ${r.invoice} order=${r.order_status} payment=${r.payment_status} total=${r.total} @ ${r.created_at?.toISOString?.()}`
    );
  }

  // ── CONSISTENCY 2: paid money with no dispatch (customer paid, no top-up) ──
  say("\n=== CONSISTENCY: PAID/SUCCESS orders never dispatched ===");
  const notDispatched = await q(
    `select invoice, status, total, provider_attempts, dispatched_at, completed_at, created_at
       from orders
      where status in ('PAID','PROCESSING')
        and dispatched_at is null
      order by created_at desc
      limit 20`
  );
  say(`  rows: ${notDispatched.rows.length}`);
  for (const r of notDispatched.rows) {
    say(
      `    ${r.invoice} status=${r.status} total=${r.total} attempts=${r.provider_attempts} created=${r.created_at?.toISOString?.()}`
    );
  }

  // ── CONSISTENCY 3: money in vs orders delivered ──
  say("\n=== CONSISTENCY: money collected vs orders settled ===");
  const money = await q(
    `select
        coalesce(sum(total) filter (where p.status in ('PAID','SETTLED')), 0) collected,
        coalesce(sum(total) filter (where o.status = 'SUCCESS'), 0)         delivered,
        coalesce(sum(total) filter (where o.status = 'FAILED'), 0)          failed,
        coalesce(sum(total) filter (where o.status = 'REFUND'), 0)          refunded
       from orders o join payments p on p.order_id = o.id`
  );
  const m = money.rows[0];
  say(`  collected (payment PAID/SETTLED): ${m.collected}`);
  say(`  delivered  (order SUCCESS):       ${m.delivered}`);
  say(`  failed     (order FAILED):        ${m.failed}`);
  say(`  refunded   (order REFUND):        ${m.refunded}`);
  say(`  gap (collected - delivered):      ${Number(m.collected) - Number(m.delivered)}`);
  say(
    `  NOTE: a non-zero gap is NOT automatically a bug — PAID orders still in dispatch,`
  );
  say(`        PROCESSING orders, and FAILED-but-paid orders all land here.`);

  // ── CONSISTENCY 4: item totals must sum to the order total ──
  say("\n=== CONSISTENCY: order_items.subtotal vs orders.total ===");
  const itemMismatch = await q(
    `select o.invoice, o.subtotal order_subtotal, o.total, o.discount, o.fee,
            (select sum(subtotal) from order_items i where i.order_id = o.id) items_sum
       from orders o
      where exists (select 1 from order_items i where i.order_id = o.id)
        and o.subtotal <> (select sum(subtotal) from order_items i where i.order_id = o.id)
      order by o.created_at desc
      limit 20`
  );
  say(`  mismatched: ${itemMismatch.rows.length}`);
  for (const r of itemMismatch.rows) {
    say(
      `    ${r.invoice} order.subtotal=${r.order_subtotal} items_sum=${r.items_sum} discount=${r.discount} fee=${r.fee} total=${r.total}`
    );
  }

  // ── CONSISTENCY 5: total arithmetic (subtotal - discount + fee) ===
  say("\n=== CONSISTENCY: total = subtotal - discount + fee ===");
  const mathMismatch = await q(
    `select invoice, subtotal, discount, fee, total
       from orders
      where total <> (subtotal - discount + fee)
      order by created_at desc
      limit 20`
  );
  say(`  mismatched: ${mathMismatch.rows.length}`);
  for (const r of mathMismatch.rows) {
    say(
      `    ${r.invoice} subtotal=${r.subtotal} discount=${r.discount} fee=${r.fee} total=${r.total} expected=${r.subtotal - r.discount + r.fee}`
    );
  }

  // ── CONSISTENCY 6: duplicate dispatch (providerAttempts > 1) ──
  say("\n=== CONSISTENCY: orders dispatched more than once ===");
  const multi = await q(
    `select invoice, status, provider_attempts, provider_ref, created_at
       from orders where provider_attempts > 1 order by created_at desc limit 20`
  );
  say(`  rows: ${multi.rows.length}`);
  for (const r of multi.rows) {
    say(
      `    ${r.invoice} status=${r.status} attempts=${r.provider_attempts} ref=${r.provider_ref} @ ${r.created_at?.toISOString?.()}`
    );
  }

  // ── CONSISTENCY 7: duplicate payments per order ──
  say("\n=== CONSISTENCY: orders with more than one payment row ===");
  const dupPay = await q(
    `select o.invoice, count(*) n_payments
       from orders o join payments p on p.order_id = o.id
      group by o.invoice having count(*) > 1
      order by o.invoice`
  );
  say(`  rows: ${dupPay.rows.length}`);
  for (const r of dupPay.rows) say(`    ${r.invoice} payments=${r.n_payments}`);

  // ── CONSISTENCY 8: orphans ──
  say("\n=== CONSISTENCY: orphaned rows ===");
  const orphans = await q(
    `select 'order without payment' what, count(*) n from orders o
        where not exists (select 1 from payments p where p.order_id = o.id)
     union all
     select 'payment without order', count(*) from payments p
        where not exists (select 1 from orders o where o.id = p.order_id)
     union all
     select 'order_item variant gone', count(*) from order_items i
        where not exists (select 1 from product_variants v where v.id = i.product_variant_id)`
  );
  for (const r of orphans.rows) say(`  ${r.what.padEnd(26)} ${r.n}`);

  // ── RECENT TRANSACTIONS: the actual end-to-end trail ──
  say("\n=== LAST 15 ORDERS (full trail) ===");
  const recent = await q(
    `select o.id, o.invoice, o.status, o.game_name, o.variant_name, o.quantity,
            o.subtotal, o.discount, o.fee, o.total, o.unit_cost_price, o.unit_selling_price,
            o.provider_ref, o.provider_status, o.provider_message, o.provider_attempts,
            o.dispatched_at, o.completed_at, o.created_at, o.updated_at,
            p.status payment_status, p.method payment_method, p.reference payment_reference, p.paid_at,
            pr.code provider_code
       from orders o
       left join payments p on p.order_id = o.id
       left join providers pr on pr.id = o.provider_id
      order by o.created_at desc
      limit 15`
  );
  for (const r of recent.rows) {
    say("");
    say(
      `${r.invoice}  status=${r.status}  ${r.game_name} / ${r.variant_name} x${r.quantity}`
    );
    say(
      `  price: subtotal=${r.subtotal} discount=${r.discount} fee=${r.fee} total=${r.total} (cost ${r.unit_cost_price} → sell ${r.unit_selling_price})`
    );
    say(
      `  payment: ${r.payment_status ?? "(none)"} via ${r.payment_method ?? "-"} ref=${r.payment_reference ?? "-"} paid_at=${r.paid_at?.toISOString?.() ?? "-"}`
    );
    say(
      `  provider: ${r.provider_code ?? "(none)"} ref=${r.provider_ref ?? "-"} status=${r.provider_status ?? "-"} attempts=${r.provider_attempts}`
    );
    say(
      `  times: created=${r.created_at?.toISOString?.()} dispatched=${r.dispatched_at?.toISOString?.() ?? "-"} completed=${r.completed_at?.toISOString?.() ?? "-"}`
    );
    if (r.provider_message) say(`  provider_message: ${String(r.provider_message).slice(0, 160)}`);

    // The event trail for THIS order, oldest first.
    const logs = await q(
      `select event, code, message, created_at from transaction_logs where order_id = $1 order by created_at asc`,
      [r.id]
    );
    say(`  logs (${logs.rows.length}):`);
    for (const l of logs.rows) {
      say(
        `    ${l.created_at?.toISOString?.()}  ${l.event}${l.code ? ` [${l.code}]` : ""}  ${String(l.message ?? "").slice(0, 120)}`
      );
    }
  }

  // ── CHECKOUT RESOLVABILITY: can a new order actually find a provider SKU? ──
  // Uses the published SQL from the guard that runs on every request: the app
  // only sells variants where an ACTIVE provider link exists.
  say("\n=== CHECKOUT RESOLVABILITY (read-only) ===");
  const buyable = await q(
    `with linked as (
        select v.id, v.slug, g.slug game_slug, v.is_active, v.stock,
               pp.provider_code, pp.is_available, pp.provider_price,
               p.status provider_status
          from product_variants v
          join products pr on pr.id = v.product_id
          join games g on g.id = pr.game_id
          join provider_products pp on pp.product_variant_id = v.id
          join providers p on p.id = pp.provider_id
         where p.status = 'ACTIVE'
       )
       select
          count(*) total_linked,
          count(*) filter (where is_available) available,
          count(*) filter (where is_available and provider_price > 0) priced,
          count(distinct game_slug) games
       from linked`
  );
  const b = buyable.rows[0];
  say(`  variants linked to an ACTIVE provider: ${b.total_linked}`);
  say(`  ... of which provider says available:   ${b.available}`);
  say(`  ... of which priced (>0):              ${b.priced}`);
  say(`  distinct games with stock:             ${b.games}`);

  const perGame = await q(
    `select g.slug, count(*) variants,
            count(*) filter (where pp.is_available) available
       from product_variants v
       join products pr on pr.id = v.product_id
       join games g on g.id = pr.game_id
       join provider_products pp on pp.product_variant_id = v.id
       join providers p on p.id = pp.provider_id
      where p.status = 'ACTIVE'
      group by g.slug order by variants desc limit 12`
  );
  say("\n  linked variants per game (top 12):");
  for (const r of perGame.rows) say(`    ${r.slug.padEnd(22)} variants=${r.variants} available=${r.available}`);

  // Variants the shop would try to sell but that have NO provider link: these
  // are the orders that would fail at dispatch with ITP_PRODUCT_UNAVAILABLE.
  say("\n  ACTIVE variants with NO provider link (would fail checkout):");
  const unlinked = await q(
    `select g.slug, pr.slug product_slug, v.slug, v.name, v.selling_price
       from product_variants v
       join products pr on pr.id = v.product_id
       join games g on g.id = pr.game_id
      where v.is_active
        and not exists (
          select 1 from provider_products pp
           join providers p on p.id = pp.provider_id
          where pp.product_variant_id = v.id and p.status = 'ACTIVE'
        )
      order by g.slug, v.sort_order limit 20`
  );
  say(`    count (capped at 20 shown): ${unlinked.rows.length}`);
  for (const r of unlinked.rows) {
    say(`      ${r.slug}/${r.product_slug}/${r.slug} "${r.name}" sell=${r.selling_price}`);
  }

  // ── Idle/stuck orders the app's own sweep should have closed ──
  say("\n=== STUCK ORDERS (open past their deadline) ===");
  const stuck = await q(
    `select invoice, status, expires_at, created_at,
            (select max(expires_at) from payments p where p.order_id = o.id) payment_expires_at
       from orders o
      where status in ('PENDING_PAYMENT','PAYMENT_PROCESSING')
        and coalesce((select max(expires_at) from payments p where p.order_id = o.id), expires_at) < now()
      order by created_at limit 20`
  );
  say(`  rows: ${stuck.rows.length}`);
  for (const r of stuck.rows) {
    say(
      `    ${r.invoice} status=${r.status} order_expiry=${r.expires_at?.toISOString?.()} payment_expiry=${r.payment_expires_at?.toISOString?.()} created=${r.created_at?.toISOString?.()}`
    );
  }

  const file = "/tmp/prod-audit.log";
  fs.writeFileSync(file, report.join("\n"));
  say(`\n[prod-audit] full report written to ${file}`);
}

main()
  .catch((err) => {
    console.error("\n[prod-audit] FAILED:", err?.message ?? err);
    console.error(err?.stack?.split("\n").slice(0, 5).join("\n"));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

// ============================================================================
// Diagnose "why can't this deployment take a payment?"
//
// Answers the three questions in order, so the answer is unambiguous:
//
//   1. Is the Server Key valid for the configured host?   (read-only)
//   2. Is the channel ACTIVATED on this merchant account? (the usual culprit)
//   3. Did instruction issuance ever succeed in the DB?   (read-only)
//
// USAGE
//   npx tsx scripts/diagnose-payment.mjs .env.prod
//   npx tsx scripts/diagnose-payment.mjs .env.dev
//
// `tsx` (not bare `node`) is required for step 3 only: the generated Prisma
// client is TypeScript. Steps 1-2 are plain fetch and run either way, and step 3
// is imported dynamically so its absence cannot hide the key/channel answer.
//
// SAFETY
//   * Nothing here prints a key or a QR payload.
//   * The channel probe is a real POST /v2/charge, because Midtrans exposes no
//     endpoint that lists a merchant's activated channels. A REJECTED charge
//     (402/404/4xx) creates nothing at the gateway, which is the normal case.
//     If a charge is unexpectedly ACCEPTED, the transaction is CANCELLED
//     immediately in the same run, so no payable instrument is ever left
//     behind. No customer money is involved either way.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const ENV_FILE = process.argv[2] || ".env.prod";

function loadEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

const env = loadEnvFile(path.resolve(ROOT, ENV_FILE));
const isProd = String(env.MIDTRANS_IS_PRODUCTION ?? "").toLowerCase() === "true";
const baseUrl = isProd ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
const serverKey = env.MIDTRANS_SERVER_KEY ?? "";
const auth = Buffer.from(`${serverKey}:`).toString("base64");
const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${auth}` };

console.log(`=== ${ENV_FILE} ===`);
console.log(`host               : ${baseUrl}`);
console.log(`PAYMENT_PROVIDER   : ${env.PAYMENT_PROVIDER}`);
console.log(`merchant id        : ${env.MIDTRANS_MERCHANT_ID}`);
console.log(`server key         : ${serverKey.length} chars, sandbox=${/^SB-/.test(serverKey)}, placeholder=${/^GANTI-/.test(serverKey)}`);
console.log(`enabled_payments   : ${env.MIDTRANS_ENABLED_PAYMENTS}`);
console.log(`NEXT_PUBLIC_APP_URL: ${env.NEXT_PUBLIC_APP_URL}`);

// ── 1. Key validity ─────────────────────────────────────────────────────────
console.log("\n[1] Server Key validity (read-only GET /v2/{order}/status)");
const probeOrder = `ITOPUP-DIAG-${Date.now()}`;
const sr = await fetch(`${baseUrl}/v2/${probeOrder}/status`, { headers, signal: AbortSignal.timeout(30_000) });
const st = await sr.text();
let sj = null; try { sj = JSON.parse(st); } catch {}
const keyOk = sj?.status_message === "Transaction doesn't exist.";
console.log(`    HTTP ${sr.status}  "${sj?.status_message ?? st.slice(0, 80)}"`);
console.log(`    => ${keyOk ? "KEY VALID for this host" : "KEY REJECTED — check the key matches MIDTRANS_IS_PRODUCTION"}`);
if (!keyOk) {
  console.log("\nStopping: a bad key explains everything, fix that first.");
  process.exit(0);
}

// ── 2. Channel activation ───────────────────────────────────────────────────
console.log("\n[2] Channel activation (POST /v2/charge, auto-cancelled if accepted)");
const stamp = Date.now();
async function probe(label, body) {
  const r = await fetch(`${baseUrl}/v2/charge`, {
    method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  const bodyStatus = String(j?.status_code ?? "?");
  const accepted = r.status === 201 || (r.status === 200 && j?.transaction_id);

  let verdict;
  if (accepted) verdict = "ACTIVATED — instrument returned";
  else if (bodyStatus === "402") verdict = "NOT ACTIVATED on this merchant";
  else verdict = `refused: "${j?.status_message ?? text.slice(0, 80)}"`;

  console.log(`    ${label.padEnd(34)} HTTP ${r.status} body=${bodyStatus}  ${verdict}`);

  if (accepted && j?.order_id) {
    const c = await fetch(`${baseUrl}/v2/${encodeURIComponent(j.order_id)}/cancel`, {
      method: "POST", headers, body: "{}", signal: AbortSignal.timeout(20_000),
    });
    console.log(`      -> probe transaction cancelled immediately (HTTP ${c.status})`);
  }
  return { label, accepted, bodyStatus };
}

const probes = [];
probes.push(await probe("qris", {
  payment_type: "qris",
  transaction_details: { order_id: `PROBE-QRIS-${stamp}`, gross_amount: 1000 },
  customer_details: { first_name: "Probe", email: "probe@example.com" },
}));
probes.push(await probe("bank_transfer/bca (Virtual Account)", {
  payment_type: "bank_transfer",
  transaction_details: { order_id: `PROBE-BCA-${stamp}`, gross_amount: 1000 },
  bank_transfer: { bank: "bca" },
}));
probes.push(await probe("gopay (e-wallet)", {
  payment_type: "gopay",
  transaction_details: { order_id: `PROBE-GOPAY-${stamp}`, gross_amount: 1000 },
}));

const activated = probes.filter((p) => p.accepted);
console.log(
  activated.length
    ? `\n    => ${activated.length}/${probes.length} channel(s) activated.`
    : `\n    => NO channel is activated. Checkout cannot take a payment until at least one\n       channel is switched on in the Midtrans dashboard (Settings > Payment Channels).`
);

// ── 3. Database history ─────────────────────────────────────────────────────
console.log("\n[3] Payment history in the database (read-only)");
const cs = env.DIRECT_URL || env.DATABASE_URL;
if (!cs) {
  console.log("    no DATABASE_URL in this env file, skipped");
} else {
  const { PrismaClient } = await import("../generated/prisma/client.ts");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cs, max: 1 }) });
  console.log(`    host: ${new URL(cs).host}`);
  console.log(`    orders            : ${await prisma.order.count()}`);
  console.log(`    payments          : ${await prisma.payment.count()}`);

  const failures = await prisma.transactionLog.findMany({
    where: { event: "PAYMENT_INSTRUCTIONS_FAILED" },
    orderBy: { createdAt: "desc" }, take: 5,
    select: { createdAt: true, code: true, message: true, metadata: true },
  });
  console.log(`    instruction failures: ${failures.length} (newest 5)`);
  for (const f of failures) {
    console.log(`      ${f.createdAt.toISOString()}  ${f.code}`);
    console.log(`        ${String(f.message ?? "").slice(0, 160)}`);
  }
  await prisma.$disconnect();
}

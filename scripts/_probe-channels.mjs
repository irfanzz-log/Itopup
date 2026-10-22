// Compare channels on the same merchant: QRIS vs bank_transfer (BCA VA).
// Tells us whether the whole merchant works or only QRIS is broken.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
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
const env = loadEnvFile(path.resolve(ROOT, ".env"));
const isProd = String(env.MIDTRANS_IS_PRODUCTION ?? "").toLowerCase() === "true";
const baseUrl = isProd ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
const auth = Buffer.from(`${env.MIDTRANS_SERVER_KEY}:`).toString("base64");
const stamp = Date.now();

async function charge(label, body) {
  const r = await fetch(`${baseUrl}/v2/charge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  const hasQr = !!(j && typeof j.qr_string === "string" && j.qr_string.length > 0);
  const acts = Array.isArray(j?.actions) ? j.actions.map(a => a.name).join(",") : "none";
  let va = "";
  if (Array.isArray(j?.va_numbers)) va = j.va_numbers.map(v => `${v.bank}=${v.va_number}`).join(" ");
  console.log(`[${label}] HTTP ${r.status} | status=${j?.status_code ?? "?"} msg="${j?.status_message ?? ""}"`);
  if (j?.transaction_status) console.log(`        transaction_status=${j.transaction_status} order=${j.order_id ?? "?"} amount=${j.gross_amount ?? "?"}`);
  if (hasQr) console.log(`        QR OK: qr_string len ${j.qr_string.length} | actions: ${acts}`);
  if (va) console.log(`        VA: ${va}`);
  return j;
}

await charge("qris            ", {
  payment_type: "qris",
  transaction_details: { order_id: `PROBE-QR-${stamp}`, gross_amount: 5000 },
});

await charge("bank_transfer   ", {
  payment_type: "bank_transfer",
  transaction_details: { order_id: `PROBE-BT-${stamp}`, gross_amount: 5000 },
  bank_transfer: { bank: "bca" },
});

await charge("gopay (ewallet) ", {
  payment_type: "gopay",
  transaction_details: { order_id: `PROBE-GP-${stamp}`, gross_amount: 5000 },
});

process.exit(0);

// End-to-end QRIS probe: POST /v2/charge with payment_type=qris, gross 5000,
// the same body shape the app sends. Confirms Midtrans returns a QR.
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
const orderId = `ITOPUP-QRPROBE-${Date.now()}`;

const body = {
  payment_type: "qris",
  transaction_details: { order_id: orderId, gross_amount: 5000 },
  customer_details: { first_name: "Probe", email: "probe@example.com" },
  item_details: [{ id: "pulsa-5000", name: "Pulsa 5000", quantity: 1, price: 5000 }],
};

const start = Date.now();
const r = await fetch(`${baseUrl}/v2/charge`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Basic ${auth}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});
const text = await r.text();
console.log(`POST /v2/charge → HTTP ${r.status} (${Date.now() - start}ms)`);
let j = null;
try { j = JSON.parse(text); } catch {}
if (j) {
  console.log("status_code:", j.status_code, "| transaction_status:", j.transaction_status, "| payment_type:", j.payment_type);
  console.log("order_id:", j.order_id, "| gross_amount:", j.gross_amount);
  console.log("qr_string present:", typeof j.qr_string === "string" && j.qr_string.length > 0, "| len:", j.qr_string?.length ?? 0);
  if (Array.isArray(j.actions)) {
    console.log("actions:", j.actions.map(a => `${a.name} ${a.method?.toUpperCase() ?? ""} ${a.url ?? ""}`).join(" | "));
  } else {
    console.log("actions: none");
  }
  if (j.status_message) console.log("status_message:", j.status_message);
  // DO NOT print qr_string itself (it is a payment payload, not a secret, but keep it short)
  if (typeof j.qr_string === "string") console.log("qr_string prefix:", j.qr_string.slice(0, 24), "...");
} else {
  console.log("raw:", text.slice(0, 400));
}
process.exit(0);

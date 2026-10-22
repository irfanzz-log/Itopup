// Verify Midtrans credentials against the PRODUCTION endpoint, read-only:
// GET /v2/{orderId}/status never mutates anything.
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
const serverKey = env.MIDTRANS_SERVER_KEY ?? "";
const clientKey = env.MIDTRANS_CLIENT_KEY ?? "";

console.log("MIDTRANS_IS_PRODUCTION:", isProd);
console.log("baseUrl:", baseUrl);
console.log("MIDTRANS_MERCHANT_ID:", env.MIDTRANS_MERCHANT_ID);
console.log("serverKey length:", serverKey.length, "| starts with:", JSON.stringify(serverKey.slice(0, 2)), "| looks like SB-:", /^SB/.test(serverKey));
console.log("clientKey length:", clientKey.length, "| starts with:", JSON.stringify(clientKey.slice(0, 2)), "| looks like SB-:", /^SB/.test(clientKey));
console.log("ENABLED_PAYMENTS:", String(env.MIDTRANS_ENABLED_PAYMENTS).slice(0, 80));
console.log("PAYMENT_PROVIDER:", env.PAYMENT_PROVIDER);

const probeOrder = `ITOPUP-PROBE-${Date.now()}`;

async function getStatus(who, key) {
  const auth = Buffer.from(`${key}:`).toString("base64");
  const start = Date.now();
  try {
    const r = await fetch(`${baseUrl}/v2/${probeOrder}/status`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await r.text();
    let note = "";
    try { note = JSON.parse(body).status_message ?? ""; } catch {}
    console.log(`[${who}] HTTP ${r.status} (${Date.now() - start}ms) ${note ? `| ${note}` : ""}`);
    return r.status;
  } catch (e) {
    console.log(`[${who}] NETWORK ERROR: ${String(e.message).split("\n")[0]}`);
    return null;
  }
}

console.log("");
const s1 = await getStatus("serverKey", serverKey);
const s2 = await getStatus("clientKey", clientKey);

console.log("");
if (s1 === 200) console.log("=> Server key VALID against", baseUrl);
else if (s1 === 401) console.log("=> Server key REJECTED (401) by", baseUrl, "— this is the QR failure: charge() never reaches the gateway.");
else console.log("=> Server key check inconclusive:", s1);
process.exit(0);

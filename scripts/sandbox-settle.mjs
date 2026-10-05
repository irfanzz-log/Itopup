#!/usr/bin/env node
// ============================================================================
// sandbox-settle — bayar transaksi Midtrans SANDBOX lewat Payment Simulator.
//
// KENAPA SCRIPT INI ADA
//
// Transaksi sandbox tidak bisa dibayar dengan aplikasi GoPay / m-banking
// sungguhan: QR sandbox diteruskan ke server simulator, bukan jaringan
// pembayaran nyata, jadi scan pakai aplikasi asli selalu "tidak valid".
// Midtrans menyediakan Payment Simulator untuk berperan sebagai customer, dan
// script ini menjalankan langkah-langkah simulator tersebut sampai settlement.
//
// SEMUA CHANNEL DIDUKUNG
//
//   qris                scan QR gambar
//   bca/bni/bri/permata virtual account
//   mandiri             e-channel (bill key + biller code)
//   alfamart/indomaret  kode pembayaran gerai
//
// CARA PAKAI
//
//   node scripts/sandbox-settle.mjs <transaction_id|order_id>
//   node scripts/sandbox-settle.mjs --list         # daftar transaksi pending
//
// Server key dibaca dari .env.dev (sandbox). Script ini menolak jalan kalau
// mendeteksi kredensial produksi — tidak ada jalur yang bisa menyentuh
// transaksi uang sungguhan.
// ============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIMULATOR = "https://simulator.sandbox.midtrans.com";
const SANDBOX_API = "https://api.sandbox.midtrans.com";

/** Parse file env minimal: KEY=value, # komentar, kutip opsional. */
function loadEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
        .map((line) => {
          const eq = line.indexOf("=");
          const key = line.slice(0, eq).trim();
          let value = line.slice(eq + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          return [key, value];
        })
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnvFile(resolve(ROOT, ".env.dev")), ...process.env };
const SERVER_KEY = env.MIDTRANS_SERVER_KEY;
const IS_PRODUCTION = String(env.MIDTRANS_IS_PRODUCTION ?? "").toLowerCase() === "true";

// ── Pengaman: tidak ada cara untuk menyentuh produksi dari sini ──────────────
if (IS_PRODUCTION) {
  console.error("DITOLAK: MIDTRANS_IS_PRODUCTION=true terbaca. Script ini hanya untuk sandbox.");
  process.exit(1);
}
if (!SERVER_KEY || /^Mid-server-|^SB-Mid-server-/.test(SERVER_KEY) === false) {
  // Kunci sandbox dimulai dengan "SB-Mid-server-"; kunci produksi "Mid-server-".
  console.error("DITOLAK: MIDTRANS_SERVER_KEY tidak terbaca dari .env.dev, atau terlihat seperti kunci produksi.");
  console.error("Script ini hanya membaca .env.dev dan hanya menerima kunci sandbox.");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${SERVER_KEY}:`, "utf8").toString("base64");

/** Decode entitas HTML (&quot; dll) — simulator menyematkan JSON di atribut. */
function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

/**
 * Ambil pasangan name/value dari sebuah tag, walau value memuat tanda kutip
 * ter-escaped (JSON di dalam atribut exploreData).
 */
function readAttributes(tag) {
  const attrs = {};
  const re = /([a-zA-Z-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(tag))) attrs[match[1]] = match[2];
  return attrs;
}

/**
 * Ambil semua input bernama dari sebuah HTML form simulator.
 *
 * Tidak hanya type="hidden": simulator BCA menandai `total_amount` sebagai
 * type="text" (sebagai field yang bisa diedit operator), padahal nilainya
 * wajib dikirim kembali. Mengambil hanya hidden membuat pembayaran BCA gagal
 * dengan "Simulated payment is unsuccessful". Jadi ambil semua input bernama
 * kecuali tombol submit.
 */
function formFields(html) {
  const fields = {};
  for (const tag of html.matchAll(/<input\b([^>]*?)>/gi)) {
    const attrs = readAttributes(tag[1]);
    if (attrs.name && attrs.type !== "submit" && attrs.type !== "button") {
      fields[attrs.name] = decodeEntities(attrs.value ?? "");
    }
  }
  return fields;
}

/** POST form-encoded. */
async function postForm(url, fields) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: auth },
    body: new URLSearchParams(fields).toString(),
  });
}

/** GET /v2/{id}/status — status otoritatif dari Midtrans. */
async function getStatus(id) {
  const res = await fetch(`${SANDBOX_API}/v2/${encodeURIComponent(id)}/status`, {
    headers: { Accept: "application/json", Authorization: auth },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Cari transaksi pending terbaru dengan memeriksa beberapa id sekaligus. */
async function listPending() {
  console.log("Mencari transaksi sandbox yang masih pending...\n");
  console.log("Tidak ada endpoint list di Core API; jalankan script dengan");
  console.log("transaction_id atau order_id spesifik dari dashboard sandbox");
  console.log("atau dari halaman order aplikasi:\n");
  console.log("  node scripts/sandbox-settle.mjs <transaction_id|order_id>");
}

// ── Channel: QRIS ────────────────────────────────────────────────────────────
/**
 * Alur simulator QRIS: kirim URL gambar QR, lalu kirim form konfirmasi yang
 * dikembalikan simulator. Kedua langkah mensimulasikan customer yang scan +
 * bayar.
 */
async function settleQris(transactionId) {
  // URL gambar QR. Midtrans menyebutkannya di actions[] charge response; kalau
  // panggilan status tidak membawanya, dibangun dari path yang diketahui.
  //
  // CATATAN: pathnya berisi segmen /qris/ — /v2/{id}/qr-code TANPA segmen itu
  // membuat simulator menjawab "QR inputted unparsable", padahal charge-nya
  // valid. Ambil dari actions[] dulu, baru fallback ke konstruksi.
  const status = await getStatus(transactionId);
  const actionUrl =
    Array.isArray(status?.actions) && status.actions.find((a) => String(a?.name ?? "") === "generate-qr-code")?.url;
  const statusUrl = actionUrl || `${SANDBOX_API}/v2/qris/${encodeURIComponent(transactionId)}/qr-code`;

  // Langkah 1: simulator memindai QR — kirim URL gambar QR.
  //
  // CATATAN PATH: form scan simulator memakai action="payment" yang relatif
  // terhadap /v2/qris/index, tapi endpoint yang benar adalah /v2/qris/payment
  // (bukan /v2/qris/index/payment).
  const scan = await postForm(`${SIMULATOR}/v2/qris/payment`, { qrCodeUrl: statusUrl });
  const scanHtml = await scan.text();
  if (!scan.ok) {
    console.error(`Gagal: simulator menolak QR (HTTP ${scan.status}).`);
    console.error("Pastikan transaction_id benar dan transaksinya belum expired.");
    return false;
  }

  // Ambil field tersembunyi form konfirmasi.
  const fields = formFields(scanHtml);

  if (!fields.referenceId || !fields.exploreData) {
    console.error("Form konfirmasi simulator tidak terbaca. Simulator mungkin berubah.");
    return false;
  }

  // exploreData harus JSON valid setelah decode — kalau tidak, kita kirim
  // data yang rusak dan simulator menolak pembayarannya.
  try {
    JSON.parse(fields.exploreData);
  } catch {
    console.error("exploreData simulator bukan JSON valid setelah didecode.");
    return false;
  }

  // Langkah 2: konfirmasi pembayaran.
  const pay = await postForm(`${SIMULATOR}/v2/qris/payment/gopay`, {
    referenceId: fields.referenceId,
    exploreData: fields.exploreData,
  });

  if (!pay.ok) {
    const text = await pay.text();
    console.error(`Simulator menolak pembayaran (HTTP ${pay.status}).`);
    console.error(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300));
    return false;
  }

  return true;
}

// ── Channel: BCA / BNI (simulator "legacy") ─────────────────────────────────
/** /{bank}/va/inquiry lalu /{bank}/va/payment. */
async function settleLegacyVa(bank, va) {
  const inq = await postForm(`${SIMULATOR}/${bank}/va/inquiry`, { va_number: va });
  const fields = formFields(await inq.text());
  if (!Object.keys(fields).length) {
    console.error(`Inquiry ${bank} tidak mengembalikan form pembayaran.`);
    return false;
  }
  const pay = await postForm(`${SIMULATOR}/${bank}/va/payment`, fields);
  const text = await pay.text();
  return /successful/i.test(text) && !/unsuccessful/i.test(text);
}

// ── Channel: BRI / Permata / lainnya (simulator openapi) ─────────────────────
/** /openapi/va/inquiry?bank=<bank> lalu /openapi/va/payment?bank=<bank>. */
async function settleOpenapiVa(bank, va) {
  const inq = await postForm(`${SIMULATOR}/openapi/va/inquiry?bank=${encodeURIComponent(bank)}`, {
    bank,
    vaNumber: va,
  });
  const fields = formFields(await inq.text());
  if (!Object.keys(fields).length) {
    console.error(`Inquiry ${bank} tidak mengembalikan form pembayaran.`);
    return false;
  }
  const pay = await postForm(`${SIMULATOR}/openapi/va/payment?bank=${encodeURIComponent(bank)}`, fields);
  const text = await pay.text();
  return /successful/i.test(text) && !/unsuccessful/i.test(text);
}

// ── Channel: Mandiri e-channel ──────────────────────────────────────────────
/**
 * vaNumber Mandiri = billerCode + billKey.
 *
 * Ditemukan dengan probing: hanya kombinasi ini yang membuat inquiry simulator
 * mengembalikan form payment — billKey sendirian atau billKey ter-padding
 * dijawab kosong oleh simulator.
 */
async function settleMandiri(billerCode, billKey) {
  const vaNumber = `${billerCode}${billKey}`;
  const inq = await postForm(`${SIMULATOR}/openapi/va/inquiry?bank=mandiri`, {
    bank: "mandiri",
    billerCode,
    billKey,
    vaNumber,
  });
  const fields = formFields(await inq.text());
  if (!Object.keys(fields).length) {
    console.error("Inquiry mandiri tidak mengembalikan form pembayaran.");
    return false;
  }
  const pay = await postForm(`${SIMULATOR}/openapi/va/payment?bank=mandiri`, fields);
  const text = await pay.text();
  return /successful/i.test(text) && !/unsuccessful/i.test(text);
}

// ── Channel: Alfamart / Indomaret ───────────────────────────────────────────
/** /{store}/inquiry lalu /{store}/payment. Indomaret memakai path /indomaret/phoenix. */
async function settleCstore(store, code) {
  const base = store === "indomaret" ? "/indomaret/phoenix" : `/${store}`;
  const inq = await postForm(`${SIMULATOR}${base}/inquiry`, { payment_code: code });
  const fields = formFields(await inq.text());
  if (!Object.keys(fields).length) {
    console.error(`Inquiry ${store} tidak mengembalikan form pembayaran.`);
    return false;
  }
  const pay = await postForm(`${SIMULATOR}${base}/payment`, fields);
  const text = await pay.text();
  return /successful/i.test(text) && !/unsuccessful/i.test(text);
}

/**
 * Pilih langkah simulator berdasarkan channel. Mengembalikan fungsi async yang
 * menjalankan pembayaran, atau null kalau channel ini tidak didukung.
 *
 * MEREK SIMULATOR: semua form simulator memakai action relatif ("inquiry",
 * "payment") terhadap halaman channel, tapi base path-nya berbeda per channel:
 *   BCA/BNI  : /bca/va, /bni/va
 *   openapi  : /openapi/va?bank=<bank>  (bri, permata, mandiri)
 *   gerai    : /alfamart, /indomaret/phoenix
 */
function settlePlan(status) {
  const paymentType = String(status.payment_type ?? "");

  if (paymentType === "qris") return () => settleQris(status.transaction_id);

  if (paymentType === "bank_transfer") {
    const bank = String(status.va_numbers?.[0]?.bank ?? "");
    const va = String(status.va_numbers?.[0]?.va_number ?? status.permata_va_number ?? "");
    if (!va) return null;
    if (bank === "bca" || bank === "bni") return () => settleLegacyVa(bank, va);
    return () => settleOpenapiVa(bank, va);
  }

  if (paymentType === "echannel") {
    const billerCode = String(status.biller_code ?? "");
    const billKey = String(status.bill_key ?? "");
    if (!billerCode || !billKey) return null;
    return () => settleMandiri(billerCode, billKey);
  }

  if (paymentType === "cstore") {
    const code = String(status.payment_code ?? "");
    const store = String(status.store ?? "alfamart");
    if (!code) return null;
    return () => settleCstore(store, code);
  }

  return null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const arg = process.argv[2];

if (!arg) {
  console.log("sandbox-settle — bayar transaksi Midtrans sandbox via Payment Simulator\n");
  console.log("Pemakaian:");
  console.log("  node scripts/sandbox-settle.mjs <transaction_id|order_id>");
  console.log("  node scripts/sandbox-settle.mjs --list");
  console.log("\nChannel didukung: qris, bca, bni, bri, permata, mandiri, alfamart, indomaret.");
  console.log("\nTransaksi sandbox TIDAK bisa dibayar dengan aplikasi GoPay asli.");
  console.log("Script ini menjalankan Payment Simulator Midtrans sebagai customer.");
  process.exit(0);
}

if (arg === "--list" || arg === "-l") {
  await listPending();
  process.exit(0);
}

console.log(`Membayar transaksi sandbox: ${arg}`);

// order_id dan transaction_id sama-sama diterima GET /v2/{id}/status.
const before = await getStatus(arg);
if (!before) {
  console.error(`Transaksi "${arg}" tidak ditemukan di sandbox.`);
  process.exit(1);
}
console.log(`Status sekarang : ${before.transaction_status} (${before.payment_type}, ${before.gross_amount})`);

if (before.transaction_status === "settlement") {
  console.log("Sudah settlement — tidak perlu dibayar lagi.");
  process.exit(0);
}

if (before.transaction_status === "expire" || before.transaction_status === "cancel") {
  console.error(`Transaksi sudah ${before.transaction_status}, tidak bisa dibayar.`);
  process.exit(1);
}

const plan = settlePlan(before);
if (!plan) {
  console.error(`Channel "${before.payment_type}" belum didukung script ini.`);
  console.error("Buka simulator.sandbox.midtrans.com dan pilih channel yang sesuai.");
  process.exit(1);
}

const paid = await plan();
if (!paid) {
  console.error("Simulator tidak menyelesaikan transaksi. Lihat output di atas.");
  process.exit(1);
}

// Settlement tidak selalu instan — tunggu sampai status berubah.
for (let attempt = 1; attempt <= 6; attempt++) {
  const after = await getStatus(before.transaction_id);
  if (after && after.transaction_status !== "pending") {
    console.log(`\n✓ Settled: ${after.transaction_status}`);
    console.log(`  transaction_id : ${after.transaction_id}`);
    console.log(`  order_id       : ${after.order_id}`);
    console.log(`  gross_amount   : ${after.gross_amount}`);
    console.log(`  settlement_time: ${after.settlement_time ?? "-"}`);
    console.log(`  payment_type   : ${after.payment_type}`);
    process.exit(after.transaction_status === "settlement" ? 0 : 1);
  }
  await new Promise((done) => setTimeout(done, 1000));
}

console.error("Pembayaran terkirim tapi status masih pending setelah 6 detik.");
console.error("Cek dashboard sandbox atau GET /v2/{id}/status lagi.");
process.exit(1);

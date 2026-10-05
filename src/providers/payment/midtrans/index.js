// ============================================================================
// Midtrans payment adapter: Core API /v2/charge.
//
// HOW CORE API WORKS (and why it replaced Snap here)
//
// Our backend POSTs the order to /v2/charge with a payment_type, and Midtrans
// returns the PAYMENT INSTRUMENT in the response body: a VA number, a QR string,
// or a payment code. We render that on our own order page, so the customer never
// leaves, and never has to re-pick the channel they already picked at checkout.
//
// Under Snap, by contrast, the customer was bounced to a Midtrans-hosted page
// and forced to choose the channel a second time, which we could not pre-select
// reliably. Snap's token was not a payment instrument, so the order page had
// nothing to show but a redirect button.
//
// THE SECURITY CONTROL IS THE SIGNATURE, NOT THE STATUS STRING. verifyWebhook
// computes SHA512(order_id + status_code + gross_amount + server_key) and
// rejects anything else BEFORE any order is touched. A forged
// {"transaction_status":"settlement"} with a bad signature must never mark an
// order paid.
// ============================================================================
import "server-only";
import { optional } from "@/lib/env.server.js";
import { paymentOk, paymentErr, PAYMENT_ERROR } from "../contract.js";
import {
  createChargeTransaction,
  getTransactionStatus,
  cancelTransaction,
  verifySignature,
  parseExpiryTime,
} from "./client.js";
import { normalizeMidtransStatus, midtransPaymentType, midtransVaBank, midtransCstoreStore } from "./map.js";
import { randomBytes } from "node:crypto";

/**
 * Parse a Midtrans `gross_amount` ("100000.00") into integer rupiah.
 *
 * Midtrans rounds IDR to the rupiah, so dropping the fraction is exact, but
 * the value may arrive as a string with cents, a bare integer, or (from a
 * notification) occasionally a number, so every shape is handled and anything
 * unparseable yields null rather than a guessed amount. A null amount reaches
 * `settlePayment` as "use what we expect", which is the safe failure.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
function parseGrossAmount(value) {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.trunc(Math.round(num * 100) / 100);
}

const CODE = "midtrans";

// The Core API host. NOTE: this is api.midtrans.com, NOT app.midtrans.com.
// The latter serves Snap, and posting /v2/charge there is a 404. The client
// composes `${baseUrl}/v2/...` from this.
const SANDBOX_BASE = "https://api.sandbox.midtrans.com";
const PRODUCTION_BASE = "https://api.midtrans.com";

/**
 * The .env files ship unset Midtrans keys as the literal placeholder
 * "GANTI-SERVER-KEY" so the line is visible and unmissable. A non-empty
 * placeholder must NOT count as configured: without this guard a developer who
 * copies the file and forgets to fill it in gets a gateway that looks live,
 * every gateway method appears at checkout, and every payment then fails with
 * a 401 from Midtrans. Treat any key still carrying the marker as unset.
 */
const PLACEHOLDER = /^GANTI-/;

function isPlaceholder(value) {
  return typeof value === "string" && PLACEHOLDER.test(value.trim());
}

/**
 * Read configuration. Server Key is the ONLY credential this adapter uses to
 * call the API: Core API authenticates with Basic Auth (username = Server
 * Key, password empty), so Merchant ID is not part of the request.
 *
 * Client Key is deliberately NOT read here. It belongs to the browser and to
 * Midtrans's hosted card form; on the server side of a /v2/charge it is never
 * sent, so reading it here would only risk logging it.
 */
export function midtransConfig() {
  const rawServerKey = optional("MIDTRANS_SERVER_KEY");
  const rawMerchantId = optional("MIDTRANS_MERCHANT_ID");
  const isProduction = optional("MIDTRANS_IS_PRODUCTION") === "true";
  const baseUrl = isProduction ? PRODUCTION_BASE : SANDBOX_BASE;
  const enabledPayments = optional("MIDTRANS_ENABLED_PAYMENTS");
  return {
    /// null (not the placeholder) when the real key is not filled in yet.
    serverKey: isPlaceholder(rawServerKey) ? null : rawServerKey,
    merchantId: isPlaceholder(rawMerchantId) ? null : rawMerchantId,
    baseUrl,
    isProduction,
    /// JSON array string e.g. ["credit_card","gopay","bca_va","qris"]; null = let
    /// Midtrans show everything enabled in the merchant dashboard.
    enabledPayments: parseEnabledPayments(enabledPayments),
  };
}

function parseEnabledPayments(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : null;
  } catch {
    return null;
  }
}

function isConfigured() {
  return Boolean(midtransConfig().serverKey);
}

function configurationGaps() {
  // Must go through midtransConfig(), not raw optional(): a placeholder key is
  // non-empty, so a raw read reports the gateway as fully configured while the
  // real key is still missing.
  const { serverKey, merchantId } = midtransConfig();
  const missing = [];
  if (!serverKey) missing.push("MIDTRANS_SERVER_KEY");
  if (!merchantId) missing.push("MIDTRANS_MERCHANT_ID");
  return { missing };
}

/**
 * Per-method servability. Midtrans serves any channel it offers, so this is an
 * adapter-level check, but reporting per method keeps the "why did my method
 * vanish?" answer honest when the gateway is not configured at all.
 */
function isMethodServable(methodKey) {
  if (!isConfigured()) {
    return { ok: false, reason: "Payment gateway Midtrans belum dikonfigurasi." };
  }
  // Midtrans decides availability in the dashboard; a method key we map to a
  // payment type is offered, and Snap hides what the merchant has not enabled.
  return { ok: true };
}

/**
 * Build the Core API /v2/charge request body.
 *
 * WHY payment_type IS REQUIRED NOW, NOT A HINT
 *
 * Snap ignores the channel at creation and lets the customer pick it again on
 * Midtrans's own page. Core API is the opposite: `payment_type` selects the
 * channel, and Midtrans returns the instrument (VA number, QR string, payment
 * code) in the response body for us to render ourselves.
 *
 * So a method with no Midtrans payment_type (the manual transfer family) is not
 * merely "not pre-selected" here; it cannot be charged at all. The adapter
 * rejects those before the call rather than sending a payload Midtrans would
 * answer with "payment_type is required", and the caller routes them to the
 * manual adapter instead.
 *
 * gross_amount MUST equal the sum of item_details, or Midtrans rejects with a
 * 400. We send exactly one item line for the order total, so the two cannot
 * diverge.
 */
function buildChargePayload({ input, config, paymentType }) {
  const amount = Math.max(0, Math.trunc(Number(input.amount) || 0));
  const description = String(input.description || `Top up ${input.invoice}`);

  const payload = {
    payment_type: paymentType,
    transaction_details: {
      order_id: String(input.invoice),
      gross_amount: amount,
    },
    item_details: [
      {
        id: String(input.invoice).slice(0, 50),
        price: amount,
        quantity: 1,
        name: description.slice(0, 50),
      },
    ],
    customer_details: {
      first_name: String(input.customerName || "Pelanggan").slice(0, 20),
      email: input.customerEmail || undefined,
    },
  };

  // Channel parameters. Core API takes these alongside payment_type, and they
  // are derived from the METHOD KEY (our catalogue), never from the payment_type
  // string: "bank_transfer" alone does not say which bank.
  const vaBank = midtransVaBank(input.method);
  if (vaBank) {
    payload.bank_transfer = { bank: vaBank };
  }

  // Mandiri e-channel. This is NOT a bank_transfer: sending payment_type
  // "echannel" with no echannel object gets a 400 "echannel is required" from
  // Midtrans. The bill info lines are what the customer sees on their Mandiri
  // statement, so the invoice goes in bill_info1; it is how the payment is
  // identified. Both lines are capped by Midtrans, hence the slice.
  const invoiceStr = String(input.invoice || "");
  if (paymentType === "echannel") {
    payload.echannel = {
      bill_info1: `Invoice ${invoiceStr}`.slice(0, 40),
      bill_info2: String(input.description || `Top up ${invoiceStr}`).slice(0, 40),
    };
  }

  const store = midtransCstoreStore(input.method);
  if (store) {
    payload.cstore = { store };
  }

  // ── Direct e-wallet charges need a return URL. ────────────────────────────
  //
  // Midtrans asks for it differently per wallet, and asking the wrong way is a
  // hard 400 with "callback_url is required.", so a wallet the customer picked
  // dies at checkout. The shapes are NOT interchangeable:
  //
  //   ShopeePay: a `shopeepay: { callback_url }` object. Both `callbacks.finish`
  //              and a root-level `callback_url` are ignored by the gateway.
  //   GoPay:     `callback_url` at the root. GoPay accepts the Snap-style
  //              `callbacks.finish` object too, but root is the documented Core
  //              API shape.
  //
  // QRIS needs neither: it is not a redirect, the customer scans and stays.
  //
  // A sandbox host is used only when the public origin is unconfigured; it is
  // never a production URL.
  if (paymentType === "shopeepay" || paymentType === "gopay") {
    const base = appBaseUrl() || (config.isProduction ? "" : "http://localhost:3000");
    if (base) {
      const url = `${base}/member/orders/${encodeURIComponent(String(input.invoice || ""))}`;
      if (paymentType === "shopeepay") {
        payload.shopeepay = { callback_url: url };
      } else {
        payload.callback_url = url;
      }
    }
  }

  if (Array.isArray(config.enabledPayments) && config.enabledPayments.length) {
    payload.enabled_payments = config.enabledPayments;
  }

  return payload;
}

/**
 * The deadline the customer sees, reconciled between the two clocks we hold.
 *
 * Midtrans's per-channel expiry is fixed by the gateway (QRIS ~15m, VA/cstore
 * ~24h) and Core API ignores every attempt to set it, so there is no way to
 * impose one window on every channel. The customer-facing deadline has to be
 * the EARLIEST of the two: whichever expires first is the real answer, and
 * showing the later one is a lie that ends in a "payable" page that rejects.
 *
 * @param {string|null} gatewayExpiryIso  UTC ISO string from parseExpiryTime()
 * @param {Date|null} orderWindow  our own order.expiresAt window
 * @returns {Date|null} the earlier deadline, or null when neither is known
 */
function reconcileExpiry(gatewayExpiryIso, orderWindow) {
  const gateway = gatewayExpiryIso ? new Date(gatewayExpiryIso) : null;
  if (gateway && Number.isNaN(gateway.getTime())) return orderWindow ?? null;
  if (!gateway && !orderWindow) return null;
  if (!gateway) return orderWindow;
  if (!orderWindow) return gateway;
  return gateway.getTime() < orderWindow.getTime() ? gateway : orderWindow;
}

/**
 * Translate a raw /v2/charge response into the `instructions` object the order
 * page renders. One branch per channel FAMILY, not per raw field, so the UI
 * never imports a Midtrans name.
 *
 * Every branch sets `payableAmount`: PaymentInstructions.jsx keys "do I have
 * an instrument to show?" on it, so a branch that omits it renders as "not
 * issued yet" even when the charge succeeded.
 */
function extractChargeInstructions(result, { amount, invoice }) {
  const { paymentType, transactionStatus } = result;

  // Bank transfer, non-Mandiri: one VA number per bank.
  if (Array.isArray(result.vaNumbers) && result.vaNumbers.length) {
    return {
      kind: "va",
      channel: "va",
      payableAmount: amount,
      invoice,
      destinations: result.vaNumbers.map((row) => ({
        name: vaBankLabel(row.bank) || "Virtual Account",
        number: String(row.va_number ?? ""),
        holder: "Midtrans Va",
      })),
      steps: [
        "Buka aplikasi mobile banking atau ATM bank yang dipilih.",
        `Pilih menu transfer ke Virtual Account, masukkan nomor VA di atas.`,
        "Masukkan nominal yang tepat, kemudian konfirmasi.",
      ],
      expiryTime: result.expiryTime ?? null,
    };
  }

  // Mandiri e-channel: no VA number, but a bill key + biller code pair.
  if (result.billKey && result.billerCode) {
    return {
      kind: "va",
      channel: "va_mandiri",
      payableAmount: amount,
      invoice,
      destinations: [
        { name: "Mandiri e-channel", number: result.billKey, holder: `Kode biller ${result.billerCode}` },
      ],
      steps: [
        "Buka aplikasi Livin' by Mandiri atau ATM Mandiri.",
        "Pilih Transfer → Ke rekening Mandiri / e-channel.",
        `Masukkan kode biller ${result.billerCode} dan nomor bill ${result.billKey}.`,
        "Masukkan nominal yang tepat, kemudian konfirmasi.",
      ],
      expiryTime: result.expiryTime ?? null,
    };
  }

  // QRIS / e-wallet: a scannable payload. Midtrans returns a qr_string when
  // the QR is generated server-side, or an actions[] entry naming
  // "generate-qr-code" whose URL returns the image.
  if (result.qrString || hasQrAction(result.actions)) {
    // The channel is the payment type as charged, not a guess from the payload
    // shape: a QRIS charge and a shopeepay/gopay QR both return actions[], and
    // labelling a QRIS charge "ewallet" made the instructions show the wrong
    // app and the wrong steps for a QRIS payment.
    return {
      kind: "qr",
      channel: typeof paymentType === "string" && paymentType ? paymentType : "qris",
      payableAmount: amount,
      invoice,
      qrString: result.qrString ?? null,
      qrImageUrl: qrActionUrl(result.actions) ?? null,
      steps: [
        "Buka aplikasi e-wallet atau aplikasi QRIS yang kamu pakai.",
        "Pindai kode QR di atas, atau salin payload QRIS-nya ke aplikasi.",
        "Masukkan nominal yang tepat, kemudian konfirmasi.",
      ],
      expiryTime: result.expiryTime ?? null,
    };
  }

  // ── ShopeePay: a deeplink, NOT a QR. ──────────────────────────────────────
  //
  // Midtrans answers ShopeePay with a single `deeplink-redirect` action and no
  // qr_string; the customer is expected to leave our page for the Shopee app.
  // Falling through to the QR branch left this charge with NO instrument at
  // all: the panel rendered nothing scannable, and the customer sat on a blank
  // payment page for an order that was perfectly live at the gateway.
  const deeplink = deeplinkActionUrl(result.actions);
  if (deeplink) {
    return {
      kind: "deeplink",
      channel: typeof paymentType === "string" && paymentType ? paymentType : "shopeepay",
      payableAmount: amount,
      invoice,
      deeplinkUrl: deeplink,
      steps: [
        "Klik tombol Bayar dengan ShopeePay untuk membuka aplikasi Shopee.",
        "Konfirmasi pembayaran di aplikasi Shopee dengan nominal yang tepat.",
        "Kembali ke halaman ini setelah selesai. Status diperbarui otomatis.",
      ],
      expiryTime: result.expiryTime ?? null,
    };
  }

  // Retail / convenience store: a payment code the customer reads at the counter.
  if (result.paymentCode) {
    return {
      kind: "cstore",
      channel: "cstore",
      payableAmount: amount,
      invoice,
      destinations: [
        { name: result.store || "Gerai ritel", number: result.paymentCode, holder: "Kode pembayaran" },
      ],
      steps: [
        "Datang ke gerai (Indomaret / Alfamart) yang menerima kode pembayaran.",
        `Beritahu kasir kode pembayaran ${result.paymentCode}.`,
        "Bayar sesuai nominal, simpan struk sebagai bukti.",
      ],
      expiryTime: result.expiryTime ?? null,
    };
  }

  // Charge accepted but Midtrans gave us no instrument we can render. This is
  // a defect or an unsupported channel, not a payment failure; the status
  // still tells the truth about the money, so we surface it rather than
  // silently inventing an instruction shape.
  return {
    kind: "gateway_pending",
    channel: paymentType || null,
    payableAmount: amount,
    invoice,
    transactionStatus: transactionStatus || null,
    transactionId: result.transactionId || null,
    expiryTime: result.expiryTime ?? null,
  };
}

function vaBankLabel(bank) {
  const label = {
    bca: "BCA Virtual Account",
    bni: "BNI Virtual Account",
    bri: "BRI Virtual Account",
    permata: "Permata Virtual Account",
    mandiri: "Mandiri Virtual Account",
  };
  return label[String(bank ?? "").toLowerCase()] || null;
}

function hasQrAction(actions) {
  return Array.isArray(actions) && actions.some((a) => String(a?.name ?? "") === "generate-qr-code");
}

function qrActionUrl(actions) {
  const found = Array.isArray(actions) && actions.find((a) => String(a?.name ?? "") === "generate-qr-code");
  return found?.url || null;
}

/**
 * The deeplink action ShopeePay answers with. Distinct from the QR actions on
 * purpose: a charge that offers BOTH (GoPay on mobile) should render the QR
 * (it works everywhere), while ShopeePay offers ONLY this, so a shared helper
 * would blur the one case that has no QR at all.
 */
function deeplinkActionUrl(actions) {
  const found = Array.isArray(actions) && actions.find((a) => String(a?.name ?? "") === "deeplink-redirect");
  return found?.url || null;
}

/**
 * The app's own public origin, for Midtrans callbacks that must be a real URL.
 *
 * NEVER falls back to a hardcoded string: if the config is missing, an empty
 * string is returned and the caller sends no callback rather than sending one
 * that points at a domain we do not own.
 */
function appBaseUrl() {
  return String(optional("NEXT_PUBLIC_APP_URL") || "").replace(/\/+$/, "");
}

export const midtransProvider = {
  code: CODE,
  name: "Midtrans",

  isConfigured,
  configurationGaps,
  isMethodServable,

  /**
   * Create a Core API charge. The "instructions" handed to the customer ARE the
   * payment instrument: the VA number, the QR string, or the payment code.
   * rendered on our own order page. No redirect to Midtrans.
   */
  async createPayment(input, { log } = {}) {
    const config = midtransConfig();
    if (!config.serverKey) {
      return paymentErr(PAYMENT_ERROR.NOT_CONFIGURED, "MIDTRANS_SERVER_KEY belum diisi.");
    }

    const amount = Math.max(0, Math.trunc(Number(input.amount) || 0));
    if (amount <= 0) {
      return paymentErr(PAYMENT_ERROR.REJECTED, "Nominal pembayaran tidak valid.");
    }

    // Core API requires the channel up front. A method with no Midtrans
    // payment_type is not ours to charge (the manual adapter owns it), so this
    // is a hard rejection, not a fallback to a Snap page that no longer exists.
    const paymentType = midtransPaymentType(input.method);
    if (!paymentType) {
      return paymentErr(
        PAYMENT_ERROR.REJECTED,
        `Metode ${input.method ?? "?"} tidak didukung Midtrans secara langsung.`
      );
    }

    // Cards cannot be charged from the server yet. Midtrans requires
    // credit_card.token_id, which only the browser can produce via Snap.js with
    // MIDTRANS_CLIENT_KEY, and this app exposes neither the key nor a card
    // form, so a card charge would 400 with "card is required". Refusing here
    // tells the operator exactly why, instead of surfacing a gateway 400 at the
    // customer. Remove this once card tokenization is implemented.
    if (paymentType === "credit_card") {
      return paymentErr(
        PAYMENT_ERROR.NOT_IMPLEMENTED,
        "Pembayaran kartu memerlukan tokenisasi kartu di sisi browser, yang belum diimplementasikan."
      );
    }

    const payload = buildChargePayload({ input, config, paymentType });

    const result = await createChargeTransaction({
      baseUrl: config.baseUrl,
      serverKey: config.serverKey,
      payload,
      log,
    });

    // ── Recover from a duplicate order_id. ─────────────────────────────────
    // Re-issuing instructions (reload, "Terbitkan QR baru") charges the SAME
    // invoice twice, and Midtrans answers 406 to the second one. The transaction
    // that 406'd is still live, but its QR/VA may be stale or expired, so the
    // old charge is cancelled and a fresh one created under a NEW invoice: the
    // only path that hands the customer an instrument they can actually pay.
    //
    // A cancelled charge is money that never arrived, so this is safe. The new
    // invoice becomes the payment's `reference`, which the caller persists; the
    // old one is dead at Midtrans the moment the cancel lands.
    if (!result.ok && result.error?.code === PAYMENT_ERROR.DUPLICATE) {
      const oldInvoice = String(input.invoice ?? "");
      log?.info?.("midtrans.charge_duplicate_retry", { reference: oldInvoice });

      await cancelTransaction({
        baseUrl: config.baseUrl,
        serverKey: config.serverKey,
        reference: oldInvoice,
        log,
      });

      // The re-issue input carries the NEW invoice, and the SAME input is what
      // mapChargeResult reads for `reference`; the two must not disagree, or
      // the payment row would point at the invoice Midtrans just cancelled.
      const reissuedInput = { ...input, invoice: newInvoiceFor(oldInvoice) };

      const retried = await createChargeTransaction({
        baseUrl: config.baseUrl,
        serverKey: config.serverKey,
        payload: buildChargePayload({ input: reissuedInput, config, paymentType }),
        log,
      });

      return mapChargeResult(retried, { input: reissuedInput, paymentType, log });
    }

    return mapChargeResult(result, { input, config, paymentType, log });
  },

  /**
   * Cancel a charge at Midtrans.
   *
   * Called before a stale instrument is replaced (an expired QRIS) so the dead
   * transaction cannot be paid into later. Midtrans's own expiry has already
   * made it unpayable, but cancelling makes the state explicit in their records
   * and stops it lurking as a settleable transaction in the dashboard.
   */
  async cancelPayment({ reference, externalId, reason }, { log } = {}) {
    const config = midtransConfig();
    if (!config.serverKey) {
      return paymentErr(PAYMENT_ERROR.NOT_CONFIGURED, "MIDTRANS_SERVER_KEY belum diisi.");
    }

    // Midtrans keys the cancel on order_id, which is OUR invoice: the reference
    // we stored. externalId is the Midtrans transaction id and is not the key
    // this endpoint expects.
    if (!reference) {
      return paymentErr(PAYMENT_ERROR.REJECTED, "Reference tidak boleh kosong untuk pembatalan.");
    }

    const result = await cancelTransaction({
      baseUrl: config.baseUrl,
      serverKey: config.serverKey,
      reference: String(reference),
      log,
    });

    if (!result.ok) {
      // 412 / REJECTED means Midtrans already closed it: the outcome we wanted,
      // so this is not an error worth surfacing to the customer.
      const alreadyClosed = result.error?.code === PAYMENT_ERROR.REJECTED;
      if (alreadyClosed) {
        log?.info?.("midtrans.cancel_already_closed", { reference });
        return paymentOk({ cancelled: false, alreadyClosed: true });
      }
      return result;
    }

    return paymentOk({ cancelled: true, alreadyClosed: false });
  },

  /**
   * Ask Midtrans directly for the payment state. Used for polling and for the
   * challenge-response check that follows a webhook, since notifications can
   * arrive out of order.
   */
  async getPaymentStatus({ reference, externalId }, { log } = {}) {
    const config = midtransConfig();
    if (!config.serverKey) {
      return paymentErr(PAYMENT_ERROR.NOT_CONFIGURED, "MIDTRANS_SERVER_KEY belum diisi.");
    }

    const result = await getTransactionStatus({
      baseUrl: config.baseUrl,
      serverKey: config.serverKey,
      reference,
      log,
    });
    if (!result.ok) return result;

    const { transactionStatus, fraudStatus, grossAmount, expiryTime, settlementTime } = result.data;
    const mapped = normalizeMidtransStatus(transactionStatus, { fraudStatus });

    // gross_amount arrives as "100000.00". Midtrans rounds to the rupiah for
    // IDR, so dropping the fraction is exact, but we only trust it when the
    // parse is clean, and otherwise leave paidAmount null rather than guessing.
    const paidAmount = mapped.status === "PAID" ? parseGrossAmount(grossAmount) : null;

    return paymentOk({
      reference,
      status: mapped.status,
      paidAmount,
      // Midtrans's settlement_time is the authoritative "money arrived" clock.
      // Falls back to now when the gateway omits it, rather than to null,
      // because a settlement with no timestamp is still a settlement.
      paidAt: mapped.status === "PAID" ? new Date(settlementTime ?? Date.now()) : null,
      // A poll can also refresh the deadline the customer sees (a re-issued
      // charge may carry a different expiry than the one stored at issue time).
      expiresAt: expiryTime ?? null,
      message: transactionStatus,
    });
  },

  /**
   * Authenticate an inbound notification.
   *
   * Signature first, always. The raw body is what carries the signature, so the
   * caller reads it before JSON-parsing and hands the parsed object here.
   */
  async verifyWebhook({ headers, rawBody, log }) {
    const config = midtransConfig();
    if (!config.serverKey) {
      return paymentErr(PAYMENT_ERROR.NOT_CONFIGURED, "MIDTRANS_SERVER_KEY belum diisi.");
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      log?.warn?.("midtrans.webhook_bad_json");
      return paymentErr(PAYMENT_ERROR.INVALID_SIGNATURE, "Body notifikasi bukan JSON valid.");
    }

    const verified = verifySignature({ serverKey: config.serverKey, body, log });
    if (!verified.ok) return verified;
    if (!verified.data.valid) {
      return paymentErr(PAYMENT_ERROR.INVALID_SIGNATURE, "Tanda tangan notifikasi tidak cocok.");
    }

    const orderId = String(body.order_id ?? "");
    const mapped = normalizeMidtransStatus(body.transaction_status, {
      fraudStatus: body.fraud_status,
    });

    return paymentOk({
      /// Midtrans's event id for replay protection. Replays of the same
      /// notification are deduped by webhook.service.js on (providerCode,
      /// externalId), so this must be unique per notification.
      eventId: body.transaction_id ? String(body.transaction_id) : `${orderId}:${mapped.status}`,
      reference: orderId,
      status: mapped.status,
      paidAmount: mapped.status === "PAID" ? parseGrossAmount(body.gross_amount) : null,
      // The authoritative clock is the gateway's, not our server's: a
      // notification can be delivered long after the money actually landed.
      // settlement_time is preferred; transaction_time is the fallback for a
      // status Midtrans treats as paid without a separate settlement field.
      // Both arrive as zone-less Jakarta time and are corrected by
      // parseExpiryTime, which despite its name parses any Midtrans timestamp.
      paidAt:
        mapped.status === "PAID"
          ? new Date(parseExpiryTime(body.settlement_time) ?? parseExpiryTime(body.transaction_time) ?? Date.now())
          : null,
      // Refresh the deadline from the notification too: an expire/cancel event
      // carries the real deadline, and keeping the issue-time value would show
      // a stale window after Midtrans has already closed the transaction.
      expiresAt: parseExpiryTime(body.expiry_time),
      message: [body.transaction_status, body.fraud_status && `fraud:${body.fraud_status}`]
        .filter(Boolean)
        .join(" "),
    });
  },

  /**
   * Refunds are not implemented: Midtrans refund is a merchant-dashboard
   * workflow with partial-refund accounting that this app has no UI for.
   * Reporting NOT_IMPLEMENTED (not NOT_CONFIGURED) keeps the operator message
   * honest without implying the adapter is broken.
   */
  async refundPayment() {
    return paymentErr(
      PAYMENT_ERROR.NOT_IMPLEMENTED,
      "Pengembalian dana Midtrans dilakukan dari dashboard merchant."
    );
  },
};

export const midtransAdapterCode = CODE;

/**
 * Turn a raw charge result into the provider shape the service consumes.
 *
 * Extracted so the duplicate-retry path and the first-attempt path build the
 * SAME result; the only difference is the invoice the charge was made under.
 *
 * @param {PaymentResult} result  the client's parsed /v2/charge outcome
 * @param {object} ctx
 * @param {object} ctx.input  the createPayment input (carries the invoice + window)
 * @param {string} ctx.paymentType
 * @param {object} [ctx.log]
 * @returns {PaymentResult}
 */
function mapChargeResult(result, { input, paymentType, log }) {
  if (!result.ok) return result;

  const amount = Math.max(0, Math.trunc(Number(input.amount) || 0));
  const invoice = String(input.invoice || "");

  const mapped = normalizeMidtransStatus(result.data.transactionStatus, {
    fraudStatus: result.data.fraudStatus,
  });

  return paymentOk({
    /// Midtrans's reference is the order_id we sent, which is OUR invoice.
    /// That is how /v2/{order_id}/status and the webhook both look it up.
    /// On a duplicate retry this is the NEW invoice: the caller persists it,
    /// which is also what makes the old reference stop being polled.
    reference: invoice,
    /// Midtrans's own transaction id, distinct from our reference, and the
    /// value the dashboard and reconciliation logs identify this charge by.
    externalId: result.data.transactionId,
    status: mapped.status,
    /// The raw channel Midtrans used, e.g. "bank_transfer" or "qris". Not
    /// displayed as-is; extractChargeInstructions carries the display form.
    method: result.data.paymentType || null,
    amount,
    /// The deadline the CUSTOMER cares about is whichever comes first:
    /// our own order window (60m by default) or what Midtrans will actually
    /// honour. Midtrans's per-channel expiry is fixed (QRIS 15m, VA 24h) and
    /// Core API rejects any attempt to set it, so the two are reconciled by
    /// taking the minimum: a QR is not payable after Midtrans expires it
    /// even if our order window is still open.
    expiresAt: reconcileExpiry(result.data.expiryTime, input.expiresAt),
    instructions: extractChargeInstructions(result.data, { amount, invoice }),
    raw: result.data.raw,
  });
}

/**
 * Derive a fresh invoice number for a duplicate charge.
 *
 * Midtrans keys a transaction on order_id, so a re-issue needs an order_id it
 * has never seen. Reusing the invoice entirely is what produced the 406. The
 * existing invoice already carries our stamp + random suffix, so a new random
 * suffix under the same date stamp is still unique, still sortable, and still
 * recognisable as the same order's payment.
 *
 * @param {string} invoice  the invoice that collided, e.g. ITP-20260927-A1B2C3D4
 * @returns {string} a new invoice number
 */
function newInvoiceFor(invoice) {
  const base = String(invoice ?? "");
  // Keep everything up to the last "-": ITP-YYYYMMDD-XXXXXXXX
  const dash = base.lastIndexOf("-");
  const prefix = dash > 0 ? base.slice(0, dash + 1) : "ITP-";
  // randomBytes, base36, no look-alikes: same scheme order.service.js uses for
  // its invoice suffixes, so the two stay indistinguishable in shape.
  const suffix = randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 8);
  return `${prefix}${suffix}`;
}

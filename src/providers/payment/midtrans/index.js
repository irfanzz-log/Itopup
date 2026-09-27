// ============================================================================
// Midtrans payment adapter — Snap API.
//
// HOW SNAP WORKS (and why it fits this app)
//
// Our backend POSTs the order to /snap/v1/transactions and receives a TOKEN.
// The browser opens Snap with that token (redirect or embedded JS); the
// customer picks the channel inside Snap's own popup; Midtrans collects the
// payment, and notifies our webhook with the result. We never see a card or
// wallet credential, and we never have to render a VA or QR ourselves — that
// is why "payment instructions" for this adapter are a redirect URL instead of
// an account number.
//
// SNAP DOES NOT SELECT THE CHANNEL AT CREATION. The payment_type is at most a
// hint to pre-select the tab the customer already chose on our page. Anything
// we send is advisory; the customer can still pay with anything Midtrans
// offers, and that is correct — refusing a working payment method because it
// was not the one they clicked is how a willing customer ends up with no way
// to pay.
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
  createSnapTransaction,
  getTransactionStatus,
  cancelTransaction,
  verifySignature,
} from "./client.js";
import { normalizeMidtransStatus, midtransPaymentType } from "./map.js";

const CODE = "midtrans";

const SANDBOX_BASE = "https://app.sandbox.midtrans.com";
const PRODUCTION_BASE = "https://app.midtrans.com";

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
 * call the API — Snap authenticates with Basic Auth (username = Server Key,
 * password empty), so Merchant ID is not part of the request.
 *
 * Client Key is deliberately NOT read here. It belongs to the browser (Snap.js);
 * we use the redirect_url flow instead, so nothing on the server uses it.
 */
export function midtransConfig() {
  const rawServerKey = optional("MIDTRANS_SERVER_KEY");
  const rawMerchantId = optional("MIDTRANS_MERCHANT_ID");
  const isProduction = optional("MIDTRANS_IS_PRODUCTION") === "true";
  const baseUrl = isProduction ? PRODUCTION_BASE : SANDBOX_BASE;
  const enabledPayments = optional("MIDTRANS_ENABLED_PAYMENTS");
  const finishUrl = optional("MIDTRANS_FINISH_URL");
  return {
    /// null (not the placeholder) when the real key is not filled in yet.
    serverKey: isPlaceholder(rawServerKey) ? null : rawServerKey,
    merchantId: isPlaceholder(rawMerchantId) ? null : rawMerchantId,
    baseUrl,
    isProduction,
    /// JSON array string e.g. ["credit_card","gopay","bca_va","qris"]; null = let
    /// Midtrans show everything enabled in the merchant dashboard.
    enabledPayments: parseEnabledPayments(enabledPayments),
    finishUrl: finishUrl || null,
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
 * adapter-level check — but reporting per method keeps the "why did my method
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
 * Build the Snap request body.
 *
 * gross_amount MUST equal the sum of item_details, or Midtrans rejects with a
 * 400. We send exactly one item line for the order total, so the two cannot
 * diverge.
 */
function buildSnapPayload({ input, config }) {
  const amount = Math.max(0, Math.trunc(Number(input.amount) || 0));
  const description = String(input.description || `Top up ${input.invoice}`);

  const payload = {
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
    credit_card: { secure: true },
    customer_details: {
      first_name: String(input.customerName || "Pelanggan").slice(0, 20),
      email: input.customerEmail || undefined,
    },
  };

  // Advisory pre-select of the channel the customer already picked. Omitted
  // entirely when the method is not a Midtrans product (null).
  const paymentType = midtransPaymentType(input.method);
  if (paymentType) payload.payment_type = paymentType;

  if (Array.isArray(config.enabledPayments) && config.enabledPayments.length) {
    payload.enabled_payments = config.enabledPayments;
  }
  if (config.finishUrl) {
    payload.callbacks = { finish: config.finishUrl };
  }

  return payload;
}

export const midtransProvider = {
  code: CODE,
  name: "Midtrans",

  isConfigured,
  configurationGaps,
  isMethodServable,

  /**
   * Create a Snap transaction. The "instructions" handed to the customer are a
   * redirect URL and token — the browser opens Snap, which renders the actual
   * VA number / QR / wallet confirmation.
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

    const payload = buildSnapPayload({ input, config });

    const result = await createSnapTransaction({
      baseUrl: config.baseUrl,
      serverKey: config.serverKey,
      payload,
      log,
      idempotencyKey: input.invoice,
    });

    if (!result.ok) return result;

    const { token, redirectUrl } = result.data;

    return paymentOk({
      /// Midtrans's reference is the order_id we sent, which is OUR invoice.
      /// That is how /v2/{order_id}/status and the webhook both look it up.
      reference: String(input.invoice),
      externalId: token,
      status: "PENDING",
      method: null,
      amount,
      expiresAt: input.expiresAt ?? null,
      instructions: {
        kind: "snap_redirect",
        snapToken: token,
        redirectUrl,
        /// The amount the customer owes, in the field the manual branch already
        /// reads. The panel keys "do I have instructions?" on this, so without
        /// it the whole Snap branch renders as "not issued yet".
        payableAmount: amount,
        invoice: String(input.invoice || ""),
      },
      raw: result.data,
    });
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

    const { transactionStatus, fraudStatus, grossAmount } = result.data;
    const mapped = normalizeMidtransStatus(transactionStatus, { fraudStatus });

    // gross_amount arrives as "100000.00". Midtrans rounds to the rupiah for
    // IDR, so dropping the fraction is exact — but we only trust it when the
    // parse is clean, and otherwise leave paidAmount null rather than guessing.
    const paidAmount = mapped.status === "PAID" ? parseAmount(grossAmount) : null;

    return paymentOk({
      reference,
      status: mapped.status,
      paidAmount,
      paidAt: mapped.status === "PAID" ? new Date() : null,
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
      paidAmount: mapped.status === "PAID" ? parseAmount(body.gross_amount) : null,
      paidAt: mapped.status === "PAID" ? new Date(body.transaction_time) : null,
      message: [body.transaction_status, body.fraud_status && `fraud:${body.fraud_status}`]
        .filter(Boolean)
        .join(" "),
    });
  },

  /**
   * Void an unpaid transaction so the VA/QR stops being payable. Midtrans
   * refuses this once settled, which is not an error condition here.
   */
  async cancelPayment({ reference, log }) {
    const config = midtransConfig();
    if (!config.serverKey) {
      return paymentErr(PAYMENT_ERROR.NOT_CONFIGURED, "MIDTRANS_SERVER_KEY belum diisi.");
    }

    const result = await cancelTransaction({
      baseUrl: config.baseUrl,
      serverKey: config.serverKey,
      reference,
      log,
    });
    if (!result.ok) return result;
    return paymentOk({ cancelled: true });
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

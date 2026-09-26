// ============================================================================
// Manual / offline transfer — payment adapter.
//
// Implements src/providers/payment/contract.js in full. Read client.js first for
// why this adapter exists and how destinations are configured.
//
// THE HONEST PART: there is no external system to talk to. A human operator is
// the authority on whether the money arrived. So:
//
//   * createPayment   — issues real instructions: destinations + the exact
//                       amount to send (order total + a unique 3-digit code).
//   * getPaymentStatus — returns PENDING. There is nothing to poll. The status
//                       changes when an operator confirms it in /dev/orders, and
//                       that path is an audited admin action, not a webhook.
//   * verifyWebhook   — returns NOT_IMPLEMENTED. No bank and no e-wallet sends us
//                       a callback. Faking a verified webhook here would create
//                       an unauthenticated endpoint that marks orders paid.
//   * cancelPayment   — voided locally.
//   * refundPayment   — NOT_IMPLEMENTED. A refund is a transfer a human makes;
//                       recording it as done automatically would be a lie.
//
// Everything it returns is derived from configuration and the order, never
// invented.
// ============================================================================
import { paymentOk, paymentErr, PAYMENT_ERROR } from "../contract.js";
import {
  loadBankAccounts, loadEwalletNumbers, transferWindowMinutes,
  buildTransferSteps, configurationGaps, isConfigured,
  isMethodConfigured, channelForMethod as channelOf,
  destinationsForMethod,
} from "./client.js";

const CODE = "manual";

/**
 * Which destination channel a method uses.
 *
 * Delegates to client.js so the rule lives in exactly one place: the same
 * function decides which destination list is loaded AND whether that list has
 * anything in it. Two copies of this rule is how a method ends up checked
 * against the wrong channel.
 */
function channelForMethod(method) {
  return channelOf(method);
}

export const manualTransferProvider = {
  code: CODE,
  name: "Transfer Manual",
  supportsMethods: ["manual_transfer", "manual_ewallet"],

  isConfigured,
  configurationGaps,

  /**
   * Method-level servability. The registry calls this when present instead of
   * the adapter-wide `isConfigured()`, because a bank method and an e-wallet
   * method can be configured independently.
   */
  isMethodServable(method) {
    return isMethodConfigured(method);
  },

  /**
   * Issue transfer instructions.
   *
   * @param {import("../contract.js").CreatePaymentInput} input
   */
  async createPayment(input) {
    const { invoice, amount, method, expiresAt, verifiedAccount } = input;

    const channel = channelForMethod(method);
    const destinations = destinationsForMethod(
      method,
      channel === "ewallet" ? loadEwalletNumbers() : loadBankAccounts()
    );

    // Refuse when THIS channel has no destination, even if the other one does.
    // Offering a bank method while only e-wallet numbers are configured would
    // send the customer to instructions they cannot follow.
    if (destinations.length === 0) {
      return paymentErr(
        PAYMENT_ERROR.NOT_CONFIGURED,
        channel === "ewallet"
          ? "Nomor e-wallet tujuan belum dikonfigurasi."
          : "Rekening tujuan transfer belum dikonfigurasi."
      );
    }

    // The customer transfers EXACTLY the order total. There is no "kode unik"
    // added on top: the amount quoted on the order page is the amount they send,
    // and the invoice number is what identifies the payment. See amount.js for
    // why the unique code was removed.
    const payableAmount = Math.max(0, Math.trunc(Number(amount) || 0));

    const reference = `${CODE}:${invoice}`;

    return paymentOk({
      reference,
      externalId: null,
      status: "PENDING",
      method,
      amount: payableAmount,
      expiresAt: expiresAt ?? new Date(Date.now() + transferWindowMinutes() * 60_000),
      instructions: {
        kind: channel === "ewallet" ? "ewallet_transfer" : "bank_transfer",
        channel,
        /// The invoice is the reference the customer writes in the transfer
        /// remark, and what the operator matches against the bank statement.
        invoice: String(invoice || ""),
        payableAmount,
        destinations,
        steps: buildTransferSteps({ channel, payableAmount, invoice }),
        windowMinutes: transferWindowMinutes(),
        /// The account the provider confirmed exists, shown as the last thing
        /// the customer checks before sending money. Null when the game has no
        /// account check or the check was unavailable.
        verifiedAccount: verifiedAccount ?? null,
      },
      raw: null,
    });
  },

  /**
   * There is no external authority to poll. Status is owned by the operator
   * confirmation flow, so this reports PENDING and lets the order service read
   * the Payment row it already has.
   */
  async getPaymentStatus({ reference }) {
    return paymentOk({
      reference,
      status: "PENDING",
      paidAmount: null,
      paidAt: null,
      message: "Menunggu verifikasi manual operator.",
    });
  },

  /**
   * No bank and no e-wallet calls us. Returning a verified webhook here would be
   * an unauthenticated "mark paid" endpoint — the single most dangerous thing
   * this codebase could contain. So it refuses, explicitly.
   */
  async verifyWebhook() {
    return paymentErr(
      PAYMENT_ERROR.NOT_IMPLEMENTED,
      "Transfer manual tidak mengirim callback; verifikasi dilakukan operator."
    );
  },

  async cancelPayment({ reference, reason }) {
    return paymentOk({ cancelled: true, reference, reason: reason ?? null });
  },

  async refundPayment() {
    return paymentErr(
      PAYMENT_ERROR.NOT_IMPLEMENTED,
      "Refund transfer manual dilakukan operator di luar sistem dan dicatat manual."
    );
  },
};

export default manualTransferProvider;

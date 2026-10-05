// ============================================================================
// Offline payment amount math, shared by every operator-verified method.
//
// WHY THIS FILE IS SHARED AND NOT PER-ADAPTER
//
// Every offline method (bank transfer, e-wallet transfer) needs the same thing:
// the exact amount the customer must send, and the steps that tell them how to
// send it. If each adapter implemented that itself, the two would drift, and the
// drift would be silent: a customer transfers what the page says, and the
// operator cannot find the payment.
//
// Pure functions only: no `server-only`, no environment, no I/O. That keeps them
// trivially testable and impossible to accidentally ship into a client bundle.
//
// NO UNIQUE AMOUNT CODE: read before re-adding one
//
// This file used to add a 3-digit "kode unik" to the payable amount so an
// operator could identify a transfer by the last three digits of the amount.
// That is gone, deliberately:
//
//   * the customer was quoted a price and then asked to send MORE than it
//     (order total 8.800 → payable 8.870). That reads as a hidden fee, and the
//     amount no longer matched the total printed on the order page;
//   * the code was arithmetic the customer had to trust rather than a field they
//     could see on their own bank form;
//   * an operator still reconciled by hand.
//
// The amount the customer sends is now EXACTLY the order total. What identifies
// the payment is the INVOICE number, which the customer writes into the bank
// transfer remark field, a real field on a real form.
// ============================================================================

import { formatNumber } from "../../lib/format.js";

/**
 * Format an amount for the instructions.
 *
 * A non-numeric input must never reach the customer as "Rp NaN": an instruction
 * that prints NaN is worse than a wrong one, because it looks like a broken page
 * and gives the customer no amount to send at all. Anything unparseable renders
 * as 0, and the surrounding text still tells them to send the amount shown on the
 * order page.
 *
 * Delegates to the shared formatter so the string is byte-identical on the
 * server and in the browser. These instructions are rendered by a server
 * component on the order page AND re-rendered on the client, so a locale-
 * dependent format here is a hydration mismatch waiting to happen.
 */
function formatAmount(value) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  return formatNumber(safe);
}

/**
 * Build the step-by-step instructions a customer follows.
 *
 * The wording differs between a bank and an e-wallet: a bank transfer has a
 * "berita/keterangan" field that carries the invoice number, while an e-wallet
 * transfer has no remark field at all. Telling a customer to fill in a field
 * their app lacks is how instructions lose credibility, so the channel decides
 * which steps are shown.
 *
 * @param {{ channel: "bank"|"ewallet", payableAmount: number, invoice?: string }} input
 * @returns {string[]}
 */
export function buildTransferSteps({ channel, payableAmount, invoice }) {
  const amount = `Rp ${formatAmount(payableAmount)}`;
  const reference = String(invoice || "").trim();
  const isEwallet = channel === "ewallet";

  const steps = [
    isEwallet
      ? `Kirim tepat ${amount} ke nomor tujuan di atas.`
      : `Transfer tepat ${amount} ke salah satu rekening di atas.`,
  ];

  if (isEwallet) {
    // No remark field exists, so say what the operator actually matches on
    // instead of asking for something the customer cannot provide.
    steps.push(
      `Jumlahnya harus tepat ${amount}, tidak lebih dan tidak kurang, karena pembayaran dicocokkan dari nominal, pengirim, dan waktu transfer.`
    );
  } else if (reference) {
    steps.push(
      `Tulis nomor invoice ${reference} pada kolom berita/keterangan transfer, agar pembayaran Anda cepat dikenali.`
    );
  } else {
    steps.push("Jumlahnya harus tepat sesuai nominal di atas.");
  }

  steps.push(
    'Setelah transfer, tekan "Saya sudah transfer" dan pembayaran diverifikasi manual oleh operator.'
  );

  return steps;
}

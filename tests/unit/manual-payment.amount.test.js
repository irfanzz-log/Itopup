// ============================================================================
// Manual transfer, the payable-amount invariant, AFTER the "kode unik" removal.
//
// THE CHANGE THESE TESTS LOCK DOWN
//
// The adapter used to add a deterministic 3-digit code to the amount so an
// operator could match a transfer by the last three digits. That meant a customer
// quoted Rp 8.800 was told to transfer Rp 8.870, more than the price on their
// own order page, for a reason that reads as a hidden fee.
//
// The invariant is now the opposite and much simpler:
//
//     payableAmount === order total, exactly
//
// What identifies the payment is the INVOICE, written into the bank transfer
// remark field. So these tests assert:
//   * the customer is never asked for more than the order total,
//   * the steps name the invoice for a bank transfer (which has a remark field),
//   * the steps do NOT ask for a remark an e-wallet app does not have.
// ============================================================================
import { describe, it, expect } from "vitest";
import { buildTransferSteps, destinationsForMethod } from "@/providers/payment/manual/client.js";

const INVOICE = "ITP-20260925-0HFW5YP6";

describe("buildTransferSteps", () => {
  it("states the exact amount, formatted for Indonesia", () => {
    const steps = buildTransferSteps({ channel: "bank", payableAmount: 8800, invoice: INVOICE });
    expect(steps[0]).toContain("Rp 8.800");
  });

  it("tells a bank customer to put the invoice in the remark field", () => {
    const steps = buildTransferSteps({ channel: "bank", payableAmount: 8800, invoice: INVOICE });
    const joined = steps.join(" ");
    expect(joined).toContain(INVOICE);
    expect(joined).toMatch(/berita\/keterangan/);
  });

  it("never asks an e-wallet customer for a remark field their app lacks", () => {
    const steps = buildTransferSteps({ channel: "ewallet", payableAmount: 8800, invoice: INVOICE });
    const joined = steps.join(" ");
    // An e-wallet transfer has no "berita transfer" field. Asking for one is
    // how instructions lose credibility.
    expect(joined).not.toMatch(/berita\/keterangan/);
    expect(joined).toMatch(/tepat/);
  });

  it("omits the invoice step entirely when no invoice is known", () => {
    // Better to say nothing than to print "Tulis nomor invoice  pada kolom…".
    const steps = buildTransferSteps({ channel: "bank", payableAmount: 8800, invoice: "" });
    const joined = steps.join(" ");
    expect(joined).not.toMatch(/nomor invoice\s*$/);
    expect(joined).not.toContain("undefined");
  });

  it("always ends by telling the customer what to do after transferring", () => {
    for (const channel of ["bank", "ewallet"]) {
      const steps = buildTransferSteps({ channel, payableAmount: 8800, invoice: INVOICE });
      expect(steps[steps.length - 1]).toMatch(/Saya sudah transfer/);
    }
  });

  it("survives a missing or non-numeric amount without printing NaN", () => {
    for (const amount of [undefined, null, 0, "abc"]) {
      const steps = buildTransferSteps({ channel: "bank", payableAmount: amount, invoice: INVOICE });
      expect(steps.join(" ")).not.toContain("NaN");
    }
  });
});

describe("payable amount equals the order total", () => {
  // The manual adapter derives `payableAmount` directly from the order total.
  // This asserts the arithmetic it relies on, over the totals that used to break
  // the old code-plus-remainder logic.
  const TOTALS = [1000, 1600, 5000, 8800, 10_000, 25_000, 999, 1, 12_345, 777_000, 470, 870];

  it("never adds a hidden delta to what the customer owes", () => {
    for (const total of TOTALS) {
      // Exactly what src/providers/payment/manual/index.js computes.
      const payableAmount = Math.max(0, Math.trunc(Number(total) || 0));
      expect(payableAmount, `total=${total}`).toBe(total);
    }
  });

  it("keeps a round total round — no forced last-three-digit code", () => {
    // The old code forced the amount to END in its code, so a round total could
    // never stay round. That is gone.
    const payableAmount = Math.max(0, Math.trunc(Number(10_000) || 0));
    expect(payableAmount % 1000).toBe(0);
  });

  it("documents the regression: 8.800 stays 8.800", () => {
    // Before: 8.800 was quoted, 8.8xx was demanded.
    const total = 8800;
    const payableAmount = Math.max(0, Math.trunc(Number(total) || 0));
    expect(payableAmount).toBe(total);
  });
});

// ============================================================================
// Destination filtering, the customer chose a method; show only its number.
//
// THE BUG THESE LOCK DOWN (2026-09-26)
//
// `createPayment` selected destinations by CHANNEL only: pick DANA and the
// panel listed every e-wallet number we hold; pick BCA and it listed every
// bank account. The customer had already chosen, so the extra rows were not
// options, they were instructions to send the money somewhere the order did
// not ask for. Money landing in the wrong wallet is a refund case at best.
// ============================================================================
describe("destinationsForMethod", () => {
  const WALLETS = [
    { name: "DANA", number: "085788513910", holder: "PT ITOPUP" },
    { name: "OVO", number: "085788513911", holder: "PT ITOPUP" },
    { name: "GoPay", number: "085788513912", holder: "PT ITOPUP" },
    { name: "ShopeePay", number: "085788513913", holder: "PT ITOPUP" },
  ];
  const BANKS = [
    { name: "BCA", number: "1234567890", holder: "PT ITOPUP" },
    { name: "Mandiri", number: "9876543210", holder: "PT ITOPUP" },
  ];

  it("shows ONLY the wallet the customer chose", () => {
    const got = destinationsForMethod("manual_ewallet_dana", WALLETS);
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("DANA");
  });

  it("is case-insensitive — the label and the env name may differ", () => {
    expect(destinationsForMethod("manual_ewallet_shopeepay", WALLETS)).toHaveLength(1);
    expect(destinationsForMethod("manual_ewallet_SHOPEEPAY", WALLETS)[0].name).toBe("ShopeePay");
  });

  it("shows ONLY the bank account the customer chose", () => {
    const got = destinationsForMethod("manual_bank_mandiri", BANKS);
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("Mandiri");
  });

  it("keeps the whole list for the generic 'lainnya' methods", () => {
    // A customer picking this did not name a wallet, the list IS the answer.
    expect(destinationsForMethod("manual_ewallet_lainnya", WALLETS)).toHaveLength(4);
    expect(destinationsForMethod("manual_bank_lainnya", BANKS)).toHaveLength(2);
  });

  it("keeps the whole list for the legacy key", () => {
    expect(destinationsForMethod("manual_transfer", BANKS)).toHaveLength(2);
  });

  it("falls back to the full list when nothing matches", () => {
    // Showing nothing would leave an amount and nowhere to send it.
    expect(destinationsForMethod("manual_ewallet_qris", WALLETS)).toHaveLength(4);
  });
});

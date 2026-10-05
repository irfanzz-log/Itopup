import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PaymentInstructions from "../../src/components/payment/PaymentInstructions.jsx";

const open = {
  orderId: "11111111-1111-4111-8111-111111111111",
  payment: {
    id: "p1",
    status: "PENDING",
    method: "manual_bank_bca",
    reference: "INV-CANCEL-1",
    instructions: {
      payableAmount: 50000,
      kind: "qr",
      invoice: "INV-CANCEL-1",
      qrImageUrl: "https://example.com/qr.png",
      expiryTime: new Date(Date.now() + 60_000).toISOString(),
    },
  },
};

describe("customer cancel affordance", () => {
  it("offers a cancel button on an open payment", () => {
    const html = renderToStaticMarkup(
      <PaymentInstructions {...open} orderStatus="PENDING_PAYMENT" />,
    );
    expect(html).toContain("Batalkan transaksi");
  });

  // The button is suppressed once the order is closed: cancelling an order we
  // already took money for is a refund, not a cancel.
  it("hides the cancel button once the order has expired", () => {
    const html = renderToStaticMarkup(
      <PaymentInstructions {...open} orderStatus="EXPIRED" />,
    );
    expect(html).not.toContain("Batalkan transaksi");
  });
});

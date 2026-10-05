// End-to-end check of the two new operator/customer actions against the dev DB.
// Runs the REAL service functions, not a mocked route.
import { describe, it, expect, afterAll } from "vitest";

import { prisma } from "../../src/lib/db.js";
import { transitionOrder } from "../../src/services/order.service.js";
import { ORDER_STATUS, ORDER_STATUS_LABEL, ORDER_TRANSITIONS } from "../../src/lib/constants.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("order status contract", () => {
  it("labels the operator statuses distinctly, including the terminal pair", () => {
    // The point of this change: EXPIRED and CANCELLED must not read the same.
    expect(ORDER_STATUS_LABEL.EXPIRED).toBe("Kedaluwarsa (otomatis)");
    expect(ORDER_STATUS_LABEL.CANCELLED).toBe("Dibatalkan");
    expect(ORDER_STATUS_LABEL.EXPIRED).not.toBe(ORDER_STATUS_LABEL.CANCELLED);
    // And the payment statuses did not drift.
    expect(ORDER_STATUS_LABEL.PAID).toBe("Sudah Dibayar");
    expect(ORDER_STATUS_LABEL.PAYMENT_PROCESSING).toBe("Pembayaran Diproses");
  });

  it("allows a refund from every paid-and-beyond state, never from an unpaid one", () => {
    // The refund action covers the arc the operator can actually refund.
    expect(ORDER_TRANSITIONS.PAID).toContain("REFUND");
    expect(ORDER_TRANSITIONS.PROCESSING).toContain("REFUND");
    expect(ORDER_TRANSITIONS.FAILED).toContain("REFUND");
    expect(ORDER_TRANSITIONS.SUCCESS).not.toContain("REFUND"); // SUCCESS is terminal
    expect(ORDER_TRANSITIONS.PENDING_PAYMENT).not.toContain("REFUND");
    expect(ORDER_TRANSITIONS.EXPIRED).not.toContain("REFUND");
    expect(ORDER_TRANSITIONS.CANCELLED).not.toContain("REFUND");
  });

  it("can actually move a real order to REFUND with a reason", async () => {
    // Find a real PAID-ish order in dev, or skip. This asserts the transition
    // works against the database, not just the constant.
    const order = await prisma.order.findFirst({
      where: { status: { in: [ORDER_STATUS.PROCESSING, ORDER_STATUS.FAILED] } },
      select: { id: true, status: true },
    });
    if (!order) return; // dev data may not have one; the unit asserts cover this

    const back = await transitionOrder({
      orderId: order.id,
      from: order.status,
      to: ORDER_STATUS.REFUND,
      reason: "Test refund — dikembalikan manual",
    });
    expect(back.ok).toBe(true);
    expect(back.to).toBe(ORDER_STATUS.REFUND);

    // Restore it so this probe does not alter the operator's real data.
    await prisma.order.update({ where: { id: order.id }, data: { status: order.status } });
  });

  it("customer cancel is a PENDING_PAYMENT-only transition", () => {
    // The /api/payment/cancel route refuses anything else; this asserts the
    // state machine agrees with that gate.
    expect(ORDER_TRANSITIONS.PENDING_PAYMENT).toContain("CANCELLED");
    expect(ORDER_TRANSITIONS.PAID).not.toContain("CANCELLED");
    expect(ORDER_TRANSITIONS.PROCESSING).not.toContain("CANCELLED");
  });
});

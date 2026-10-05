import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
describe("drift", () => {
  it("finds payment/order mismatches", async () => {
    const mismatch = await prisma.$queryRawUnsafe(`
      SELECT o.invoice, o.status::text AS order_status, p.status::text AS pay_status,
             o."dispatchedAt", o."providerRef"
      FROM orders o JOIN payments p ON p."orderId" = o.id
      WHERE (p.status::text = 'EXPIRED' AND o.status::text NOT IN ('EXPIRED','CANCELLED'))
         OR (p.status::text = 'PAID' AND o.status::text IN ('PENDING_PAYMENT','PAYMENT_PROCESSING'))`);
    const processing = await prisma.$queryRawUnsafe(`
      SELECT o.invoice, o.status::text AS order_status,
             (SELECT p.status::text FROM payments p WHERE p."orderId" = o.id ORDER BY p."createdAt" DESC LIMIT 1) AS pay_status,
             o."dispatchedAt", o."providerRef", o."updatedAt"
      FROM orders o WHERE o.status::text IN ('PROCESSING','PAID')
      ORDER BY o."updatedAt" DESC LIMIT 20`);
    writeFileSync("/tmp/drift.json", JSON.stringify({mismatch, processing}, (k,v)=> v instanceof Date ? v.toISOString() : v, 2));
    await prisma.$disconnect();
  });
});

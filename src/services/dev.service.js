// ============================================================================
// Dev dashboard aggregation.
//
// WHY THIS IS A SERVICE
//
// The dashboard needs revenue, margin, order counts, member counts and provider
// state. Computing that in the page component would put business arithmetic in a
// view, and the same numbers are needed by the /dev/orders summary bar. One
// place, one definition of "revenue".
//
// WHAT COUNTS AS REVENUE: orders that actually completed (SUCCESS). An order
// that is PAID but still PROCESSING is money received but not yet delivered —
// reporting it as revenue would overstate the business and hide a stuck queue.
// Both are returned separately so the dashboard can show the distinction instead
// of hiding it.
//
// Aggregates run in the DATABASE (groupBy/count), never by loading rows into
// Node and reducing them. That is the difference between a dashboard that keeps
// working at 100k orders and one that times out.
// ============================================================================
import { prisma } from "../lib/db.js";
import { ORDER_STATUS } from "../lib/constants.js";

const PAID_STATUSES = [ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING];

/** Orders per status, as a lookup map. */
export async function orderStatusCounts() {
  const rows = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const counts = {};
  for (const status of Object.values(ORDER_STATUS)) counts[status] = 0;
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

/**
 * Revenue and margin, split by whether the goods were actually delivered.
 *
 * `margin` is stored per order at creation time (unitSellingPrice - unitCostPrice
 * × quantity, net of discount) so it reflects the price that was actually
 * charged. Recomputing it from today's product prices would silently rewrite
 * history.
 */
export async function revenueSummary({ since = null } = {}) {
  const where = since ? { createdAt: { gte: since } } : {};

  const [completed, inFlight] = await Promise.all([
    prisma.order.aggregate({
      where: { ...where, status: ORDER_STATUS.SUCCESS },
      _sum: { total: true, margin: true, discount: true, fee: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: { ...where, status: { in: PAID_STATUSES } },
      _sum: { total: true, margin: true },
      _count: { _all: true },
    }),
  ]);

  return {
    /// Money for delivered goods — the only figure safe to call revenue.
    completed: {
      orders: completed._count._all,
      total: completed._sum.total ?? 0,
      margin: completed._sum.margin ?? 0,
      discount: completed._sum.discount ?? 0,
      fee: completed._sum.fee ?? 0,
    },
    /// Money received but not yet delivered. A growing number here is a problem,
    /// not a success.
    inFlight: {
      orders: inFlight._count._all,
      total: inFlight._sum.total ?? 0,
      margin: inFlight._sum.margin ?? 0,
    },
  };
}

/** Member counts by status and role. */
export async function memberSummary() {
  const [total, active, blocked, staff, newToday] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "BLOCKED" } }),
    prisma.user.count({ where: { role: { in: ["DEV", "SUPERADMIN"] } } }),
    prisma.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return { total, active, blocked, staff, newToday };
}

/**
 * Operational queue: orders that need a human.
 *
 * These are the numbers that matter at 9am: unpaid orders about to expire,
 * payments a customer says they made, and dispatches that did not resolve.
 */
export async function actionQueue() {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 60 * 1000);

  const [awaitingPayment, expiringSoon, awaitingVerification, stuckProcessing, failedToday] =
    await Promise.all([
      prisma.order.count({ where: { status: ORDER_STATUS.PENDING_PAYMENT } }),
      prisma.order.count({
        where: {
          status: { in: [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAYMENT_PROCESSING] },
          expiresAt: { not: null, lte: soon, gte: now },
        },
      }),
      // Customer pressed "I have transferred" — an operator must confirm.
      prisma.payment.count({ where: { status: "PROCESSING" } }),
      // Dispatched but unresolved for over 10 minutes: needs reconciliation.
      prisma.order.count({
        where: {
          status: ORDER_STATUS.PROCESSING,
          updatedAt: { lte: new Date(now.getTime() - 10 * 60 * 1000) },
        },
      }),
      prisma.order.count({
        where: {
          status: ORDER_STATUS.FAILED,
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

  return { awaitingPayment, expiringSoon, awaitingVerification, stuckProcessing, failedToday };
}

/** The newest orders, for the dashboard's activity list. */
export async function recentOrders(limit = 8) {
  return prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, limit)),
    select: {
      id: true,
      invoice: true,
      status: true,
      gameName: true,
      variantName: true,
      total: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
}

/** Provider rows with their cached balance, for the dashboard strip. */
export async function providerOverview() {
  return prisma.provider.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      status: true,
      balance: true,
      balanceUpdatedAt: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      priority: true,
    },
  });
}

/** One call for everything the dashboard renders. */
export async function dashboardSnapshot() {
  const [statuses, revenue, members, queue, orders, providers] = await Promise.all([
    orderStatusCounts(),
    revenueSummary(),
    memberSummary(),
    actionQueue(),
    recentOrders(),
    providerOverview(),
  ]);

  return { statuses, revenue, members, queue, orders, providers };
}

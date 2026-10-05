// ============================================================================
// Status badge.
//
// Every status string in the app comes from src/lib/constants.js. A status the
// badge does not recognise renders as the raw value in a neutral tone, never
// as a blank chip, because a blank chip looks like a styling bug and hides the
// real problem (an unmapped status reaching the UI).
// ============================================================================
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_STATUS_LABEL, CUSTOMER_ORDER_STATUS } from "@/lib/constants";

const PAYMENT_TONE = {
  PENDING: "warning",
  PROCESSING: "info",
  PAID: "success",
  FAILED: "danger",
  EXPIRED: "neutral",
  REFUNDED: "neutral",
  CANCELLED: "neutral",
};

const TONE_CLASS = {
  success: "bg-success-bg text-success-fg border-success-border",
  warning: "bg-warning-bg text-warning-fg border-warning-border",
  danger: "bg-danger-bg text-danger-fg border-danger-border",
  info: "bg-info-bg text-info-fg border-info-border",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-border",
};

/**
 * @param {"order"|"payment"} kind  which lifecycle the status belongs to
 * @param {"customer"|"operator"} audience  who reads this badge
 *
 * `operator` shows the raw lifecycle ("Dibayar", "Pembayaran Diproses"), the
 * operator can act on the difference between "money captured" and "provider
 * dispatching". `customer` collapses those into the four ideas a buyer deals
 * with, so two statuses that mean the same thing to them do not appear side by
 * side as if they were different.
 */
export default function StatusBadge({ status, kind = "order", audience = "operator", className = "" }) {
  const isPayment = kind === "payment";
  const orderLabel =
    audience === "customer" && CUSTOMER_ORDER_STATUS[status]
      ? CUSTOMER_ORDER_STATUS[status]
      : ORDER_STATUS_LABEL[status];
  const label = isPayment ? PAYMENT_STATUS_LABEL[status] : orderLabel;
  const tone = isPayment ? PAYMENT_TONE[status] : ORDER_STATUS_TONE[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone] ?? TONE_CLASS.neutral} ${className}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
        aria-hidden="true"
      />
      {label ?? status ?? "—"}
    </span>
  );
}

/** Variant for the admin tables, where the status column needs a stable width. */
export function StatusCell({ status, kind = "order" }) {
  return (
    <span className="inline-flex min-w-[9.5rem]">
      <StatusBadge status={status} kind={kind} />
    </span>
  );
}

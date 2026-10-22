// ============================================================================
// VerdictBadge — "normal / mencurigakan / berbahaya" as one chip.
//
// A SERVER component: it renders from props and holds no state, so the log
// tables stay server-rendered and ship no JavaScript for a coloured chip.
//
// WHY THE REASON IS A TITLE AND NOT A COLUMN
// The verdict alone is a verdict; the reason is the evidence. In a table with
// six other columns the reason would be truncated to nothing, so it lives in the
// tooltip and in full on the detail page. `title` is also what a screen reader
// announces on hover, which is the accessible half of the same idea.
// ============================================================================
import { VERDICT, VERDICT_LABEL, VERDICT_TONE } from "@/lib/traffic/classify.js";

const TONE_CLASS = {
  success: "bg-success-bg text-success-fg border-success-border",
  warning: "bg-warning-bg text-warning-fg border-warning-border",
  danger: "bg-danger-bg text-danger-fg border-danger-border",
  info: "bg-info-bg text-info-fg border-info-border",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-border",
};

export default function VerdictBadge({ verdict, reason = null, rule = null, className = "" }) {
  const tone = VERDICT_TONE[verdict] ?? "neutral";
  const label = VERDICT_LABEL[verdict] ?? verdict ?? "—";
  const title = [reason, rule].filter(Boolean).join(" · ");

  return (
    <span
      title={title || undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        TONE_CLASS[tone] ?? TONE_CLASS.neutral
      } ${className}`}
    >
      {/* A dot, not an icon: at this size a glyph is unreadable and the colour
          already carries the meaning. The text is what a screen reader reads. */}
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          verdict === VERDICT.HOSTILE ? "bg-danger-fg" : verdict === VERDICT.SUSPICIOUS ? "bg-warning-fg" : "bg-success-fg"
        }`}
      />
      {label}
    </span>
  );
}

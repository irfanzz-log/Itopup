// ============================================================================
// Announcement banner — the topmost element of the public site.
//
// A server component: it reads the announcement from the database at request
// time and renders nothing when there is nothing to say. It sits ABOVE the
// header in the root layout, so it is the first thing a customer sees on every
// page, above the navigation, above the hero.
//
// WHY A DISMISSIBLE-LOOKING BANNER IS NOT A MODAL
//
//   The requirement is a warning at the very top of the page, not a dialog
//   that blocks reading the catalogue. A modal over a maintenance notice would
//   stop a returning customer from checking their order history, which is
//   exactly what they came to do during an outage. This banner occupies the
//   top slot and flows with the content instead.
//
//   It is deliberately NOT dismissible. A maintenance notice the customer can
//   click away is a notice they forget about, and the "pause all transactions"
//   case needs every visitor to keep seeing it for as long as it is true.
//   The operator turns it off from /dev/announcements; that is the one switch.
// ============================================================================
const TONES = {
  info: { alert: "info", banner: "bg-info-bg text-info-fg border-info-border" },
  warning: { alert: "warning", banner: "bg-warning-bg text-warning-fg border-warning-border" },
  error: { alert: "danger", banner: "bg-danger-bg text-danger-fg border-danger-border" },
};

/**
 * @param {{ announcement: { tone: string, title: string, body: string|null, pauseCheckout: boolean } | null }} props
 */
export default function AnnouncementBanner({ announcement }) {
  if (!announcement) return null;

  const tone = TONES[announcement.tone] ?? TONES.info;

  return (
    <div
      role="alert"
      className={`border-b px-4 py-3 text-sm ${tone.banner}`}
      data-announcement
    >
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <svg
          className="mt-0.5 h-4.5 w-4.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          />
        </svg>

        <div className="min-w-0 flex-1">
          <p className="font-semibold">{announcement.title}</p>
          {announcement.body ? (
            <p className="mt-0.5 opacity-90">{announcement.body}</p>
          ) : null}
          {announcement.pauseCheckout ? (
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-80">
              Seluruh transaksi untuk sementara dinonaktifkan
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

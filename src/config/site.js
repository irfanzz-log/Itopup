// ============================================================================
// Site-wide contact details.
//
// ONE source of truth. A support number typed into three components drifts:
// the footer gets updated, the help page keeps the old one, and a customer
// messages a number nobody reads. Everything that shows a contact number
// imports from here.
//
// Formatting rule: `display` is what a human reads and dials; `wa` is the
// E.164-ish form wa.me requires (no leading 0, no "+", no spaces). Keeping both
// means no component does string surgery on a phone number, which is how
// "0857…" becomes "857…" and the link silently breaks.
// ============================================================================

/** The one support line. Used for WhatsApp, and as the destination for every
 *  offline e-wallet transfer so a customer never has to guess which number to
 *  send to. */
export const SUPPORT_PHONE = {
  display: "0857 7619 1048",
  compact: "085776191048",
  wa: "6285776191048",
};

/** Pre-filled WhatsApp link. The message names the invoice so an operator can
 *  find the order without a round trip asking for it. */
export function supportWhatsAppUrl(message) {
  const text = message?.trim() || "Halo ITOPUP, saya butuh bantuan.";
  return `https://wa.me/${SUPPORT_PHONE.wa}?text=${encodeURIComponent(text)}`;
}

export const SUPPORT_HOURS = "Setiap hari, 24 jam";

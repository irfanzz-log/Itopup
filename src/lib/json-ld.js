// ============================================================================
// JSON-LD builder.
//
// Every node here describes something the page ACTUALLY shows. Nothing is
// invented: no aggregateRating (we do not collect reviews), no Offer with a
// fabricated `availability`, no Organisation address we do not have. Schema
// that contradicts the visible content is a rich-result penalty risk, so the
// rule is: if the page does not render it, it does not go in the schema.
//
// Nodes are plain objects rendered by <JsonLd> (next/src/app/.../page) as a
// single script tag per page. One tag per page, not one per component: the
// alternative is emitting two BreadcrumbList nodes for one page, which Google
// reports as a duplicate.
// ============================================================================
import { absoluteUrl } from "@/lib/site-url.js";

/**
 * Organisation + WebSite, for the homepage only.
 *
 * `sameAs` is deliberately empty: linking to social profiles we do not control
 * would be a fabricated identity claim. Add real profile URLs here when they
 * exist, not before.
 */
export function websiteJsonLd({ name = "ITOPUP", description = "" } = {}) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${absoluteUrl("")}/#organization`,
        name,
        url: absoluteUrl(""),
      },
      {
        "@type": "WebSite",
        "@id": `${absoluteUrl("")}/#website`,
        url: absoluteUrl(""),
        name,
        description,
        inLanguage: "id-ID",
        publisher: { "@id": `${absoluteUrl("")}/#organization` },
      },
    ],
  };
}

/**
 * BreadcrumbList from the trail a page actually renders.
 *
 * `trail` is the same array of { name, path } the page passes to its <nav>, so
 * the schema and the visible breadcrumb cannot drift apart. The last item is
 * always the current page (name, no URL is required for the current page, but
 * including it is harmless and makes the node self-contained).
 */
export function breadcrumbJsonLd(trail = []) {
  const items = trail
    .filter((step) => step && typeof step.name === "string")
    .map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      ...(step.path ? { item: absoluteUrl(step.path) } : {}),
    }));

  if (items.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

/**
 * Product + Offer for ONE game's top-up page.
 *
 * The page renders a grid of nominals; the schema describes the page-level
 * product, which is what the customer searched for ("top up mobile legends").
 * `offers` is a single aggregate Offer at the lowest ACTIVE price the page
 * actually displays, so the price in schema is always a price the customer
 * sees. `priceCurrency` is IDR for every nominal on this site.
 *
 * No `availability` is claimed when stock is untracked (the common case):
 * schema.org's default is InStock and asserting it for a provider-supplied
 * item we do not control would be a guess.
 */
export function productJsonLd({ name, description = "", path, breadcrumbTrail = [], offers = [] }) {
  if (!name || !path) return null;

  const validOffers = offers.filter(
    (offer) => Number.isFinite(offer.price) && offer.price > 0
  );

  const node = {
    "@type": "Product",
    name,
    ...(description ? { description } : {}),
    url: absoluteUrl(path),
    brand: { "@type": "Brand", name },
  };

  if (validOffers.length > 0) {
    const lowest = validOffers.reduce((min, offer) => (offer.price < min ? offer.price : min), validOffers[0].price);

    node.offers = {
      "@type": "Offer",
      priceCurrency: "IDR",
      price: lowest,
      priceValidUntil: undefined,
      url: absoluteUrl(path),
      seller: { "@type": "Organization", name: "ITOPUP" },
      // Availability is only asserted when the variant's stock is a finite,
      // non-zero number. Null stock means untracked and is omitted rather than
      // defaulted to InStock.
      ...(validOffers.some((o) => o.availability === "https://schema.org/InStock")
        ? { availability: "https://schema.org/InStock" }
        : {}),
    };
  }

  const graph = [node];
  const breadcrumb = breadcrumbJsonLd(breadcrumbTrail);
  if (breadcrumb) graph.push(breadcrumb);

  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * FAQPage, for a page that renders an actual FAQ section.
 *
 * The questions must be visible on the page — this builder takes the same
 * array the FAQ section renders. An FAQ schema with answers the customer
 * cannot read on the page is a policy violation, not a rich result.
 */
export function faqJsonLd(entries = []) {
  const items = entries
    .filter((entry) => entry && entry.q && entry.a)
    .map((entry) => ({
      "@type": "Question",
      name: entry.q,
      acceptedAnswer: { "@type": "Answer", text: entry.a },
    }));

  if (items.length === 0) return null;

  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items };
}

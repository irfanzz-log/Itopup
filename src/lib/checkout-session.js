// ============================================================================
// Session-gate helpers for the checkout flow.
//
// Extracted from TopupForm so the two decisions that actually decide where a
// customer ends up can be tested without a DOM, a router, or a fetch mock.
//
// WHY THIS EXISTS AT ALL: the guest redirect in TopupForm was dead code for a
// long time. `apiFetch` normalises a failure to
// `{ ok: false, error: { code, message, status } }` and the component tested
// `result.status === 401`, i.e. `undefined === 401`. A guest therefore stayed
// on the form reading "Silakan masuk terlebih dahulu" instead of being sent to
// /login. The shape of the failure envelope is not something to re-derive at
// each call site.
// ============================================================================

/**
 * Is this failure "you are not signed in"?
 *
 * Reads the status from `error` FIRST because that is where apiFetch puts it,
 * and falls back to a top-level `status` so a differently-shaped failure (a
 * hand-built object, an older caller) is still recognised. The error CODE is
 * checked too: a route can answer with `success: false` and a 200, and a proxy
 * error page can carry the status without the body. Reading only one of the
 * three is how a gate silently stops gating.
 *
 * @param {{ ok?: boolean, status?: number, error?: { code?: string, status?: number } }} result
 * @returns {boolean}
 */
export function isUnauthorized(result) {
  if (!result || result.ok) return false;
  const status = result.error?.status ?? result.status;
  return status === 401 || result.error?.code === "ITP_UNAUTHORIZED";
}

/**
 * Where the customer lands after signing in: the page they were buying from.
 *
 * Pulsa operators live at /topup/pulsa/[operator], NOT /topup/pulsa/pulsa.
 * `product.slug` is the operator's slug on pulsa pages (one product per page);
 * on a game page the product is a tab (Diamonds, Weekly Pass) and must not
 * appear in the path, so the game path is used.
 *
 * @param {{ categoryKind?: string|null, slug: string }} game
 * @param {{ slug?: string }|null} product
 * @returns {string}
 */
export function checkoutReturnPath(game, product) {
  const segment = game?.categoryKind === "PULSA" ? "pulsa" : "game";
  if (game?.categoryKind === "PULSA" && product?.slug) {
    return `/topup/pulsa/${product.slug}`;
  }
  return `/topup/${segment}/${game?.slug ?? ""}`;
}

/**
 * Build the /login URL that brings the customer back to `path`.
 *
 * Encoded once, here, so no caller can forget it: an unencoded `next` with a
 * query string would be truncated at the `?` and land the customer on the
 * wrong page after signing in.
 */
export function loginUrlFor(path) {
  return `/login?next=${encodeURIComponent(path)}`;
}

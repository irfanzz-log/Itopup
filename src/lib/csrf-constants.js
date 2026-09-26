// ============================================================================
// CSRF wire names — the ONLY CSRF module a client component may import.
//
// WHY THIS FILE EXISTS
//
// `csrf.js` imports `node:crypto` and `./errors.js`. The browser bundle pulls in
// every module in an import graph, so a client component importing `csrf.js` for
// two string constants drags the whole server graph along with it. Today Next's
// tree-shaking happens to drop it, so the build succeeds and no `node:crypto`
// ends up in `.next/static/`. That is luck, not a design: the next refactor (a
// top-level side effect, a re-export, a change in how the bundler evaluates
// `server-only`) turns it into a build failure or, worse, a leaked secret.
//
// So the wire names live here, in a module with NO imports at all. Anything that
// runs in the browser imports this; anything that runs on the server may import
// either this or `csrf.js`.
// ============================================================================

/** Cookie that carries the double-submit CSRF token. */
export const CSRF_COOKIE = "itp_csrf";

/** Header the client echoes the token in on mutating requests. */
export const CSRF_HEADER = "x-csrf-token";

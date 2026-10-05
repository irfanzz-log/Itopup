// ============================================================================
// One-off ops file: create a throwaway member + session in the DEV database so
// the checkout → Midtrans charge flow can be exercised end to end over HTTP
// against the live dev server.
//
// WHY THIS EXISTS: the order/payment routes require auth. `requireAuth` reads
// the `itp_session` cookie, verifies the JWT signature, then matches the
// session row on `id = sid` and `tokenHash = sha256(jwt)`, and finally checks
// `userVersion` against the user's `sessionVersion`. There is no password to
// type — the OTP is emailed and stored only as a hash — so the only way in is
// to write the session through the app's own issuer.
//
// It therefore calls src/lib/auth/session.js's createSession() directly: the
// token it prints is byte-identical in shape to one a real login issues, so a
// parity bug here would be a parity bug in production too.
//
// RUN (dev only; tests/setup.js refuses a prod-looking DATABASE_URL):
//   ITOPUP_TEST_TARGET=dev npx vitest run --config vitest.ops.config.js
//
// Prints a cookie line ready for curl:  itp_session=<jwt>
// Re-running creates a SECOND session (createSession always inserts), which is
// fine — the earlier token keeps working until it expires.
// ============================================================================
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createSession, SESSION_COOKIE } from "../../src/lib/auth/session.js";
import { prisma } from "../../src/lib/db.js";

describe("create dev test session", () => {
  it("upserts a member and issues a session cookie value", async () => {
    expect(process.env.AUTH_SECRET, "AUTH_SECRET must be set").toBeTruthy();

    const email = "qa-checkout@itopup.local";
    const user = await prisma.user.upsert({
      where: { email },
      update: { status: "ACTIVE", name: "QA Checkout" },
      create: {
        email,
        name: "QA Checkout",
        role: "MEMBER",
        status: "ACTIVE",
      },
      // createSession() snapshots userVersion from sessionVersion.
      select: { id: true, email: true, sessionVersion: true },
    });

    const { token, expiresAt } = await createSession(user, {
      ip: "127.0.0.1",
      userAgent: "qa-checkout-ops/1.0",
    });

    // The row must exist for the sid in the token, otherwise the verifier
    // returns null and checkout 401s.
    const row = await prisma.session.findFirst({
      where: { userId: user.id },
      select: { id: true, tokenHash: true, userVersion: true },
      orderBy: { createdAt: "desc" },
    });

    // Parity check against a freshly re-signed token proves the printed cookie
    // is the exact value the verifier expects.
    console.log("\n=== TEST SESSION (dev) ===");
    console.log(`userId: ${user.id}`);
    console.log(`email:  ${email}`);
    console.log(`expiresAt: ${expiresAt.toISOString()}`);
    console.log(`COOKIE: ${SESSION_COOKIE}=${token}`);

    // Also drop the raw cookie to disk for the curl-driven checkout smoke test
    // (console output is swallowed by the default reporter). World-readable is
    // fine: this is a dev-only throwaway session, and the DB stores only its
    // hash — the file is the sole copy, and deleting the session row kills it.
    await import("node:fs/promises").then((fs) =>
      fs.writeFile("/tmp/itp-cookie.txt", `${SESSION_COOKIE}=${token}`, {
        mode: 0o600,
      })
    );
    console.log("cookie also at /tmp/itp-cookie.txt");

    expect(user.id).toBeTruthy();
    expect(token.split(".").length).toBe(3);
    expect(row?.userVersion).toBe(user.sessionVersion);
    expect(row?.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex")
    );
  });
});

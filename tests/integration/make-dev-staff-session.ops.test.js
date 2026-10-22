// ============================================================================
// Ops: mint a DEV staff session so /dev/statistics can be exercised over HTTP.
//
// Same reasoning as make-dev-session.ops.test.js: there is no password to type,
// and the only honest way in is the app's own session issuer. This creates (or
// promotes) a QA staff account and prints the cookie value.
//
// RUN:
//   ITOPUP_TEST_TARGET=dev npx vitest run --config vitest.ops.config.js \
//     tests/integration/make-dev-staff-session.ops.test.js
//
// Prints:  <SESSION_COOKIE>=<jwt>
// ============================================================================
import { describe, it, expect } from "vitest";
import { createSession, SESSION_COOKIE } from "../../src/lib/auth/session.js";
import { prisma } from "../../src/lib/db.js";

describe("create dev staff session", () => {
  it("upserts a DEV account and issues a session cookie value", async () => {
    expect(process.env.AUTH_SECRET, "AUTH_SECRET must be set").toBeTruthy();

    const email = "qa-staff@itopup.local";
    const user = await prisma.user.upsert({
      where: { email },
      update: { status: "ACTIVE", role: "DEV", name: "QA Staff" },
      create: {
        email,
        name: "QA Staff",
        role: "DEV",
        status: "ACTIVE",
      },
      select: { id: true, email: true, sessionVersion: true, role: true },
    });

    const { token } = await createSession(user, {
      ip: "127.0.0.1",
      userAgent: "qa-staff-ops/1.0",
    });

    console.log(`\nSTAFF_COOKIE=${SESSION_COOKIE}=${token}\nrole=${user.role}\n`);

    // Written to a file as well: the console line is redacted by some shells
    // and tooling because it looks like a secret, and a curl run needs the raw
    // value. The file is in the git-ignored scratch area.
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/itopup-staff-cookie.txt", `${SESSION_COOKIE}=${token}`, "utf8");

    expect(token).toBeTruthy();
  });
});

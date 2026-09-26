// Proves supabase/admin.sql produces an account that can actually log in.
//
// The unit-level check (bcryptjs.compare against a pgcrypto hash) already
// passes; this goes further and runs the REAL loginUser() service, because that
// is the code path /login uses. If this passes, the SQL file is genuinely
// sufficient to get into the admin panel.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db.js";
import { loginUser } from "../../src/services/user.service.js";
import { ROLES } from "../../src/lib/constants.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PASSWORD = "UjiAdmin-2026!";
const EMAIL = "admin@itopup.local";

/** Apply supabase/admin.sql with the placeholder password replaced. */
async function applyAdminSql(password = PASSWORD) {
  const sql = readFileSync(resolve(ROOT, "supabase/admin.sql"), "utf8")
    .replace("GANTI-PASSWORD-INI", password);
  // The file ends with a verification SELECT; run it statement by statement so
  // the SELECT's result set does not confuse the driver.
  for (const stmt of sql.split(/;\s*\n(?=\s*(?:CREATE|INSERT|SELECT|--|$))/i)) {
    const cleaned = stmt.trim();
    if (!cleaned || /^--/.test(cleaned) && !/\b(CREATE|INSERT|SELECT)\b/i.test(cleaned)) continue;
    await prisma.$executeRawUnsafe(cleaned);
  }
}

describe("supabase/admin.sql → real login", () => {
  it("creates an operator that loginUser() accepts", async () => {
    await applyAdminSql();

    const created = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { id: true, role: true, status: true, sessionVersion: true },
    });
    console.log("\n=== row created by admin.sql ===");
    console.log(JSON.stringify(created, null, 2));
    expect(created).toBeTruthy();
    expect(created.role).toBe(ROLES.SUPERADMIN);
    expect(created.status).toBe("ACTIVE");

    // ── The real thing: authenticate through the service ───────────────────
    const result = await loginUser(
      { email: EMAIL, password: PASSWORD },
      { ip: "127.0.0.1", userAgent: "vitest" }
    );

    console.log("\n=== loginUser() SUCCEEDED ===");
    console.log(`user : ${result.user.email} (${result.user.role})`);
    console.log(`token: ${String(result.token).slice(0, 12)}… (${String(result.token).length} chars)`);
    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe(EMAIL);

    // A session row must exist, or the cookie would not authenticate.
    const sessions = await prisma.session.count({ where: { userId: created.id } });
    expect(sessions).toBeGreaterThan(0);

    // ── And the wrong password must still fail ─────────────────────────────
    await expect(
      loginUser({ email: EMAIL, password: "not-the-password" }, {})
    ).rejects.toThrow();
    console.log("wrong password correctly rejected");
  }, 60_000);

  it("is idempotent and rotates sessionVersion on re-run (kills old sessions)", async () => {
    await applyAdminSql();
    const first = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { id: true, sessionVersion: true },
    });

    await applyAdminSql();

    const second = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { id: true, sessionVersion: true },
    });
    const total = await prisma.user.count({ where: { email: EMAIL } });

    console.log(`\nsessionVersion: ${first.sessionVersion} → ${second.sessionVersion}`);
    console.log(`users with that email: ${total} (must be 1)`);
    expect(total).toBe(1);
    expect(second.id).toBe(first.id);
    expect(second.sessionVersion).toBe(first.sessionVersion + 1);
  }, 60_000);
});

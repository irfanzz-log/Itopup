// Confirm which password variant Supabase accepts. Never prints the password.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { Pool } from "pg";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
function loadEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}
const env = loadEnvFile(path.resolve(ROOT, ".env"));
const u = new URL(env.DIRECT_URL);

async function attempt(label, pw) {
  const cs = `postgresql://${u.username}:${encodeURIComponent(pw)}@${u.host}${u.pathname}`;
  let pool;
  try {
    pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 15_000 });
    const r = await pool.query("select current_user as who");
    console.log(`[OK]   ${label}  (pw len ${pw.length}) -> connected as ${r.rows[0].who}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${label}  (pw len ${pw.length}) -> ${String(e.message).split("\n")[0]}`);
    return false;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

// Variant A: password is stored percent-encoded in .env (i.e. the .env value
// already contains %21/%23), and the app sends it verbatim — that means the
// server receives the encoded form. This is what "don't touch .env" implies.
// Variant B: password stored percent-encoded, but should be decoded first.
const rawPw = u.password; // already percent-ENCODED form, e.g. contains %21
console.log("stored password length (as in .env, URL-parsed):", rawPw.length);

await attempt("A. use password exactly as stored", rawPw);

try {
  const decoded = decodeURIComponent(rawPw);
  console.log("decoded password length:", decoded.length);
  await attempt("B. decode percent-encoding first", decoded);
} catch (e) {
  console.log("decode failed:", e.message);
}
process.exit(0);

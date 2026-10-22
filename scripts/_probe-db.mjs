// One-off connection probe: try the .env credentials several ways, report exactly
// which variant fails and with what error. Never prints the password.
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

function parseConn(s) {
  // returns {ok, user, host, port, db, passRaw, passDecoded}
  try {
    const u = new URL(s);
    return {
      ok: true,
      user: u.username,
      host: u.hostname,
      port: u.port,
      db: u.pathname.slice(1),
      passRaw: u.password,          // as URL-decoded by the URL parser
      query: u.search,
    };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

async function attempt(label, connStr, { prepare } = {}) {
  let pool;
  try {
    pool = new Pool({ connectionString: connStr, max: 1, connectionTimeoutMillis: 15_000, prepare });
    const r = await pool.query("select 1 as ok, current_user as who");
    console.log(`[OK]   ${label} -> connected as ${r.rows[0].who}`);
    return true;
  } catch (e) {
    const msg = String(e.message).split("\n")[0];
    console.log(`[FAIL] ${label} -> ${msg}`);
    return false;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

const base = parseConn(env.DATABASE_URL);
const direct = parseConn(env.DIRECT_URL);
console.log("DATABASE_URL parse:", base.ok ? `user=${base.user} host=${base.host}:${base.port} db=${base.db} query=${base.query} passLen=${base.passRaw.length}` : `PARSE FAIL ${base.err}`);
console.log("DIRECT_URL   parse:", direct.ok ? `user=${direct.user} host=${direct.host}:${direct.port} db=${direct.db} query=${direct.query} passLen=${direct.passRaw.length}` : `PARSE FAIL ${direct.err}`);

console.log("");
// 1) pooler URL verbatim
await attempt("1. DATABASE_URL as-is (PgBouncer/prepare true)", env.DATABASE_URL, { prepare: false });
// 2) direct URL verbatim
await attempt("2. DIRECT_URL as-is (session mode)", env.DIRECT_URL);
// 3) sqlite-style param string (some tools need this)
if (base.ok) {
  const cs3 = `postgresql://${base.user}:${encodeURIComponent(base.passRaw)}@${base.host}:${base.port}/${base.db}${base.query}`;
  await attempt("3. DATABASE_URL re-encoded", cs3, { prepare: false });
  const cs4 = `postgresql://${base.user}:${encodeURIComponent(direct.passRaw)}@${direct.host}:${direct.port}/${direct.db}`;
  await attempt("4. DIRECT_URL re-encoded", cs4);
  // 5) parameter style, no query
  const cs5 = `postgresql://${base.user}:${encodeURIComponent(base.passRaw)}@${base.host}:${base.port}/${base.db}?pgbouncer=true`;
  await attempt("5. DATABASE_URL explicit pgbouncer", cs5, { prepare: false });
}
process.exit(0);

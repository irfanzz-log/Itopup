// Connection probe with char-class visibility only — no secret ever printed.
// Tests the literal "Akun123%21%23" style against the server.
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

const cls = (pw) => [...pw].map(c => /[a-z]/.test(c) ? "a" : /[A-Z]/.test(c) ? "A" : /\d/.test(c) ? "9" : JSON.stringify(c)).join(" ");

async function attempt(label, pw) {
  const cs = `postgresql://${u.username}:${encodeURIComponent(pw)}@${u.host}${u.pathname}`;
  let pool;
  try {
    pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 15_000 });
    const r = await pool.query("select current_user as who");
    console.log(`[OK]   ${label}\n        pw classes: ${cls(pw)}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${label}\n        pw classes: ${cls(pw)}\n        error: ${String(e.message).split("\n")[0]}`);
    return false;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

console.log("user:", u.username, "host:", u.host);
console.log("");

// 1) The 13-char literal form with %21/%23 left as literal percent signs
await attempt("1) literal 13-char form (% as literal chars)", "Akun123%21%23".replace(/^(.)A/, "$1A"));
// 2) The 9-char decoded form
await attempt("2) decoded 9-char form", decodeURIComponent("Akun123%21%23"));
// 3) A137 literal form
await attempt("3) literal A + 137", "A" + "137" + "%21%23");
// 4) decoded variant of #3
await attempt("4) decoded variant of #3", "A" + "137" + "!#");

process.exit(0);

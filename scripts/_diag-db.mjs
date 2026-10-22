// One-off: diagnose the Supabase connection string in .env WITHOUT printing secrets.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const raw = fs.readFileSync(path.resolve(ROOT, ".env"), "utf8");

for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  if (!t.startsWith("DATABASE_URL") && !t.startsWith("DIRECT_URL")) continue;
  const eq = t.indexOf("=");
  const key = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  console.log("---", key);
  console.log("  raw length:", v.length,
    "| first char:", JSON.stringify(v[0]),
    "| last char:", JSON.stringify(v[v.length - 1]));
  const unquoted = v.replace(/^["']|["']$/g, "");
  if (v !== unquoted) {
    console.log("  quotes present:", JSON.stringify(v[0]), JSON.stringify(v[v.length - 1]));
    console.log("  length after stripping quotes:", unquoted.length);
  } else {
    console.log("  quotes present: none");
  }
  try {
    const u = new URL(unquoted);
    console.log("  scheme:", u.protocol, "| host:", u.host, "| user:", JSON.stringify(u.username));
    console.log("  db:", u.pathname.slice(1));
    console.log("  password length:", u.password.length);
    console.log("  password contains special chars:",
      [...u.password].some(c => !"A-Za-z0-9".includes(c) ? /[A-Za-z0-9]/.test(c) === false : false) ||
      /[^A-Za-z0-9]/.test(u.password));
    console.log("  password chars classes:",
      "lower=" + /[a-z]/.test(u.password),
      "upper=" + /[A-Z]/.test(u.password),
      "digit=" + /\d/.test(u.password),
      "special=" + /[^A-Za-z0-9]/.test(u.password));
    console.log("  query:", u.search);
    console.log("  pgbouncer=true:", /pgbouncer=true/i.test(u.search));
  } catch (e) {
    console.log("  URL PARSE FAILED:", e.message);
  }
}

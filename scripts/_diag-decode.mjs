// Reproduce the exact double-decoding bug: URL parses %XX as escapes, then `pg`
// decodes AGAIN. Demonstrates which password the server actually receives.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const raw = fs.readFileSync(path.resolve(ROOT, ".env"), "utf8");
for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.startsWith("DATABASE_URL")) continue;
  const v = t.slice(t.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  const u = new URL(v);
  console.log("password as URL parsed (what .env gives to pg):");
  console.log("  len:", u.password.length);
  console.log("  classes:", [...u.password].map(c => /[a-z]/.test(c) ? "a" : /[A-Z]/.test(c) ? "A" : /\d/.test(c) ? "9" : JSON.stringify(c)).join(" "));
  // pg does decodeURIComponent again on the password
  try {
    const double = decodeURIComponent(u.password);
    console.log("after pg's decodeURIComponent (double decode):");
    console.log("  len:", double.length);
    console.log("  classes:", [...double].map(c => /[a-z]/.test(c) ? "a" : /[A-Z]/.test(c) ? "A" : /\d/.test(c) ? "9" : JSON.stringify(c)).join(" "));
  } catch (e) {
    console.log("  double decode error:", e.message);
  }
}

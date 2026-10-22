// Reproduce the exact class of bug: a %XY sequence where Y is a hex digit but X
// is NOT, e.g. "%X9". The URL parser leaves it alone, but pg's decodeURIComponent
// also leaves it alone — so both agree. If instead the .env contains a valid-but-
// unintended escape, pg double-decodes. Check which one applies here.
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
  const pw = u.password;
  console.log("DATABASE_URL password raw bytes (escaped):");
  console.log("  hex:", Buffer.from(pw, "utf8").toString("hex"));
  console.log("  escaped:", [...pw].map(c => {
    const code = c.charCodeAt(0);
    if (c === "%") return "%";
    if (code < 33 || code > 126) return `\\x${code.toString(16)}`;
    return c;
  }).join(""));
  // find every %XY in the password as it appears in the FILE (before URL parsing)
  const fileValue = v;
  const pwInFile = fileValue.slice(fileValue.indexOf("://") + 3).split("@")[0].split(":").slice(1).join(":");
  console.log("  password as written in .env (before URL parsing), escaped:");
  console.log("    ", [...pwInFile].map(c => {
    const code = c.charCodeAt(0);
    if (code < 33 || code > 126) return `\\x${code.toString(16)}`;
    return c;
  }).join(""));
  const seqs = pwInFile.match(/%.{2}/g);
  console.log("  %XY sequences found in file:", seqs ? seqs.length : 0, seqs ? JSON.stringify(seqs.map(s => s)) : "");
  // what does URL do with each?
  if (seqs) {
    for (const s of seqs) {
      const hex = s.slice(1);
      const isHex = /^[0-9a-fA-F]{2}$/.test(hex);
      console.log(`    ${s} -> valid hex escape: ${isHex}` + (isHex ? ` -> decodes to ${JSON.stringify(String.fromCharCode(parseInt(hex, 16)))}` : " -> left literal by URL parser"));
    }
  }
}

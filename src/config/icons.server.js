// ============================================================================
// Game icon files: server-only.
//
// src/config/icons.js is imported by CLIENT components (the catalogue cards,
// the checkout rail). Reading the /public directory with node:fs from that
// module leaks the fs request into the browser bundle and Turbopack refuses to
// emit the chunk ("the chunking context does not support external modules
// (request: node:fs)").
//
// So the directory scan lives HERE, behind `import "server-only"`, and the
// client-safe module receives the result as a value. The split is the same one
// the codebase already uses for payment config (src/config/payment.server.js).
// ============================================================================
import "server-only";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ICONS_ROOT = path.resolve(process.cwd(), "public/icons");
const PUBLIC_ROOT = path.resolve(process.cwd(), "public");

const GAME_ICON_EXTS = [".webp", ".png", ".jpg", ".jpeg", ".svg"];

/**
 * Scan /public/icons/games and map `slug → "games/<file>"`.
 *
 * File names are 1:1 with the game slug, so a new game needs no code change;
 * drop the artwork in and the map picks it up on the next server render. A
 * hand-written list here is what let games sit without artwork until someone
 * remembered to add the line.
 *
 * @returns {Record<string, string>}
 */
export function scanGameIcons() {
  const out = {};
  let names = [];
  try {
    names = readdirSync(path.join(ICONS_ROOT, "games"));
  } catch {
    // Directory missing (a build without /public mounted, or a fresh checkout
    // before assets are restored). An empty map degrades gracefully: cards fall
    // back to branded initials, which is visible and fixable, rather than
    // failing the build over artwork.
    names = [];
  }

  for (const name of names) {
    const dot = name.lastIndexOf(".");
    if (dot < 1) continue;
    const ext = name.slice(dot).toLowerCase();
    if (!GAME_ICON_EXTS.includes(ext)) continue;
    const slug = name.slice(0, dot);
    if (!slug) continue;
    // Two files for one slug (codm.jpg and codm.webp) would otherwise both map
    // and the last one wins arbitrarily. First-seen keeps the existing asset.
    if (!(slug in out)) out[slug] = `games/${name}`;
  }
  return out;
}

/**
 * Pixel dimensions of a local image, read from its header.
 *
 * WHY NOT A LIBRARY: `sharp` is present only as a transitive dependency of
 * Next's image pipeline. Depending on it directly would make a structured-data
 * field break on a future upgrade of a package we do not control, for a value
 * that is 4 numbers in the first bytes of the file.
 *
 * Supports the formats /public actually holds: PNG, JPEG, WebP, GIF. SVG is
 * deliberately absent — a vector has no pixel size, and the structured-data
 * builder excludes it for that reason (see productImageUrls).
 *
 * A parse failure returns null, which callers treat as "dimensions unknown"
 * rather than "unusable": a file that exists and is a raster format is still a
 * valid image URL even if this header reader does not recognise its variant.
 *
 * @param {string} absPath filesystem path
 * @returns {{ width: number, height: number } | null}
 */
export function readImageSize(absPath) {
  let buf;
  try {
    if (!statSync(absPath).isFile()) return null;
    buf = readFileSync(absPath);
  } catch {
    return null;
  }

  // ── PNG: IHDR is always the first chunk ──────────────────────────────────
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // ── GIF: logical screen descriptor ───────────────────────────────────────
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // ── WebP: VP8X (extended), VP8 (lossy), VP8L (lossless) ──────────────────
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      // 24-bit little-endian, stored as size-1.
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    if (kind === "VP8 ") {
      // 14-bit dimensions after the 3-byte start code at offset 23.
      return {
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
    }
    if (kind === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // ── JPEG: walk the segment chain to a start-of-frame marker ──────────────
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1];
      // SOF0..SOF15, excluding the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      const length = buf.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }

  return null;
}

/**
 * Candidate images for a `/public`-relative path OR an absolute http(s) URL,
 * with dimensions where they can be read.
 *
 * A game's `logo` column may hold either: the checked-in file (the common
 * case) or a remote URL an operator pasted into /dev/products. Dropping the
 * remote case would silently leave that game without the one CRITICAL field in
 * a merchant listing, so it is passed through with unknown dimensions — the
 * URL is still crawlable, and `productImageUrls` treats "unknown" as "probably
 * fine" rather than as a reason to exclude it.
 *
 * @param {string[]} paths `/icons/...` paths or absolute URLs
 * @returns {Array<{ path: string, width: number|null, height: number|null }>}
 */
export function localImageCandidates(paths = []) {
  const out = [];
  for (const candidate of paths) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;

    // A remote asset: usable as-is, dimensions unknowable without a fetch.
    if (/^https?:\/\//i.test(candidate)) {
      out.push({ path: candidate, width: null, height: null });
      continue;
    }

    if (!candidate.startsWith("/")) continue;
    const abs = path.join(PUBLIC_ROOT, candidate.replace(/^\/+/, ""));
    // Refuse to escape /public: a `../` in a stored logo URL must not turn this
    // into an arbitrary-file reader.
    if (!abs.startsWith(PUBLIC_ROOT + path.sep)) continue;
    const size = readImageSize(abs);
    out.push({ path: candidate, width: size?.width ?? null, height: size?.height ?? null });
  }
  return out;
}

// ============================================================================
// Image dimension reader.
//
// `Product.image` is the one CRITICAL field in a merchant listing, and Google
// wants ≥50K pixels. That decision needs real dimensions, so the server reads
// them from the file header instead of taking a dependency on `sharp` (which
// is only present as a transitive dep of Next's image pipeline and could
// vanish on an upgrade).
//
// THE RISK THIS TEST COVERS: a wrong byte offset does not throw. It returns a
// plausible number, the 50K check silently passes or fails, and the only
// symptom is a Search Console warning weeks later. So the assertions run
// against the ACTUAL checked-in artwork, whose sizes were verified
// independently, rather than against hand-built buffers.
// ============================================================================
import { describe, it, expect } from "vitest";
import path from "node:path";
import { readImageSize, localImageCandidates } from "@/config/icons.server.js";

const ROOT = path.resolve(process.cwd(), "public");

describe("readImageSize", () => {
  it("reads a WebP (VP8X extended header)", () => {
    // 1400×1400, verified independently with `sips -g pixelWidth`.
    const size = readImageSize(path.join(ROOT, "icons/games/valorant.webp"));
    expect(size).toEqual({ width: 1400, height: 1400 });
  });

  it("reads a smaller WebP, so the parser is not tuned to one size", () => {
    const size = readImageSize(path.join(ROOT, "icons/games/tiktok-gift-card.webp"));
    expect(size).toEqual({ width: 239, height: 211 });
  });

  it("reads a JPEG (segment-walking to the SOF marker)", () => {
    const size = readImageSize(path.join(ROOT, "icons/games/codm.jpg"));
    expect(size).toEqual({ width: 256, height: 256 });
  });

  it("reads a PNG", () => {
    // The telco marks are 160×160 PNGs.
    const size = readImageSize(path.join(ROOT, "icons/telcos/telco-telkomsel.png"));
    expect(size).toEqual({ width: 160, height: 160 });
  });

  it("returns null for a file that does not exist instead of throwing", () => {
    expect(readImageSize(path.join(ROOT, "icons/games/does-not-exist.png"))).toBeNull();
  });

  it("returns null for a non-image", () => {
    expect(readImageSize(path.join(ROOT, "..", "package.json"))).toBeNull();
  });

  // An SVG is a legitimate asset the site renders, but it has no pixel size and
  // must not be reported as a merchant-listing image.
  it("returns null for an SVG", () => {
    expect(readImageSize(path.join(ROOT, "icons/games/efootball.svg"))).toBeNull();
  });
});

describe("localImageCandidates", () => {
  it("attaches the real dimensions to a /public path", () => {
    const [entry] = localImageCandidates(["/icons/telcos/telco-xl.png"]);
    expect(entry.path).toBe("/icons/telcos/telco-xl.png");
    expect(entry.width).toBe(160);
    expect(entry.height).toBe(160);
  });

  it("ignores bare relative paths and traversal attempts", () => {
    const out = localImageCandidates([
      "/../package.json",
      "icons/games/x.png",
      "",
      null,
    ]);
    expect(out).toEqual([]);
  });

  // A `logo` column can hold a URL an operator pasted into /dev/products.
  // Dropping it would leave that game with the critical missing-image error.
  it("passes a remote URL through with unknown dimensions", () => {
    const [entry] = localImageCandidates(["https://cdn.example.com/x.png"]);
    expect(entry).toEqual({ path: "https://cdn.example.com/x.png", width: null, height: null });
  });
});

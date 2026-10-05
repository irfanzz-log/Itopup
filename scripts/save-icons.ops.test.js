// Download the brand thumbnails into /public/icons/games.
//
// Icons are stored LOCALLY, never hotlinked: a brand CDN URL changes when the
// publisher pushes new art, and hotlinking adds a third-party dependency to the
// checkout page for a 4KB image we can serve ourselves (see the policy comment
// at the top of src/config/icons.js).
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("download icons", () => {
  it("saves each thumbnail as a local file", async () => {
    const list = JSON.parse(await readFile("/tmp/thumbs.json", "utf8"));
    const outDir = path.resolve("./public/icons/games");

    const report = { saved: [], failed: [] };
    for (const item of list.downloaded ?? []) {
      try {
        const res = await fetch(item.url);
        if (!res.ok) { report.failed.push({ slug: item.slug, status: res.status }); continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        // The CDN serves .webp; the existing local files are png/jpg. Keep the
        // provider's real content type rather than lying in the extension.
        const ct = (res.headers.get("content-type") || "image/png").split(";")[0].trim();
        const ext = ct.includes("webp") ? "webp" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : "png";
        const file = path.join(outDir, `${item.slug}.${ext}`);
        writeFileSync(file, buf);
        report.saved.push({ slug: item.slug, file: path.basename(file), bytes: buf.length });
      } catch (e) {
        report.failed.push({ slug: item.slug, error: String(e?.message ?? e) });
      }
    }
    writeFileSync("/tmp/icons-saved.json", JSON.stringify(report, null, 2));
    expect(report.saved.length).toBeGreaterThan(0);
  });
});

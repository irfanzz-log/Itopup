import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";

describe("appSetting", () => {
  it("reads the table", async () => {
    const rows = await prisma.appSetting.findMany({ take: 5, select: { key: true } });
    writeFileSync("/tmp/setting.json", JSON.stringify({ count: rows.length, keys: rows.map((r) => r.key) }));
  });
});

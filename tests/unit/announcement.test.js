// Unit tests for the announcement service.
//
// The service has three behaviours that matter: a disabled row renders nothing,
// a malformed row renders nothing, and the checkout gate defaults to open.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Prisma is mocked so these tests do not need a database: the service's
// contract is what it does with the row it is handed, not what the DB stores.
vi.mock("../../src/lib/db.js", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { readAnnouncement, isCheckoutPaused, writeAnnouncement, deleteAnnouncement } from "../../src/services/announcement.service.js";
import { prisma } from "../../src/lib/db.js";

function setRow(value, updatedAt = new Date("2026-10-03T00:00:00Z")) {
  prisma.appSetting.findUnique.mockResolvedValue(value === null ? null : { key: "announcement", value, updatedAt });
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.appSetting.upsert.mockResolvedValue({});
});

describe("readAnnouncement", () => {
  it("returns null when there is no row", async () => {
    setRow(null);
    expect(await readAnnouncement()).toBeNull();
  });

  it("returns null when disabled", async () => {
    setRow({ enabled: false, tone: "warning", title: "Maintenance", body: null, pauseCheckout: true });
    expect(await readAnnouncement()).toBeNull();
  });

  it("returns null when the title is empty", async () => {
    setRow({ enabled: true, tone: "warning", title: "   ", body: null, pauseCheckout: false });
    expect(await readAnnouncement()).toBeNull();
  });

  it("returns null when the stored shape is not an object", async () => {
    setRow("just a string");
    expect(await readAnnouncement()).toBeNull();
  });

  it("returns a normalised announcement when enabled", async () => {
    setRow({ enabled: true, tone: "error", title: "Transaksi dinonaktifkan", body: "Gangguan provider.", pauseCheckout: true });

    const got = await readAnnouncement();
    expect(got).toEqual({
      enabled: true,
      tone: "error",
      title: "Transaksi dinonaktifkan",
      body: "Gangguan provider.",
      pauseCheckout: true,
      updatedAt: "2026-10-03T00:00:00.000Z",
    });
  });

  it("coerces an unknown tone to info", async () => {
    setRow({ enabled: true, tone: "nonsense", title: "Halo", body: null, pauseCheckout: false });
    expect((await readAnnouncement()).tone).toBe("info");
  });

  it("drops an empty body to null", async () => {
    setRow({ enabled: true, tone: "info", title: "Halo", body: "   ", pauseCheckout: false });
    expect((await readAnnouncement()).body).toBeNull();
  });

  it("survives a database failure by returning null", async () => {
    prisma.appSetting.findUnique.mockRejectedValue(new Error("connection refused"));
    expect(await readAnnouncement()).toBeNull();
  });
});

describe("isCheckoutPaused", () => {
  it("is open when there is no row", async () => {
    setRow(null);
    expect(await isCheckoutPaused()).toBe(false);
  });

  it("is paused when enabled and pauseCheckout is true", async () => {
    setRow({ enabled: true, pauseCheckout: true });
    expect(await isCheckoutPaused()).toBe(true);
  });

  it("is open when pauseCheckout is set but the banner is disabled", async () => {
    setRow({ enabled: false, pauseCheckout: true });
    expect(await isCheckoutPaused()).toBe(false);
  });

  it("defaults to open on a database failure", async () => {
    prisma.appSetting.findUnique.mockRejectedValue(new Error("connection refused"));
    expect(await isCheckoutPaused()).toBe(false);
  });
});

describe("deleteAnnouncement", () => {
  it("deletes the row", async () => {
    prisma.appSetting.delete.mockResolvedValue({});
    expect(await deleteAnnouncement()).toBe(true);
    expect(prisma.appSetting.delete).toHaveBeenCalledWith({ where: { key: "announcement" } });
  });

  it("returns false when the row is already absent (P2025)", async () => {
    const err = new Error("Record not found");
    err.code = "P2025";
    prisma.appSetting.delete.mockRejectedValue(err);
    expect(await deleteAnnouncement()).toBe(false);
  });

  it("rethrows unexpected errors", async () => {
    const err = new Error("connection refused");
    prisma.appSetting.delete.mockRejectedValue(err);
    await expect(deleteAnnouncement()).rejects.toThrow("connection refused");
  });
});

describe("writeAnnouncement", () => {
  it("stores the announcement", async () => {
    const stored = await writeAnnouncement({
      enabled: true, tone: "warning", title: "Maintenance", body: "Sebentar lagi.", pauseCheckout: false,
    });

    expect(stored).toEqual({
      enabled: true, tone: "warning", title: "Maintenance", body: "Sebentar lagi.", pauseCheckout: false,
    });
    expect(prisma.appSetting.upsert).toHaveBeenCalledOnce();
    const args = prisma.appSetting.upsert.mock.calls[0][0];
    expect(args.where.key).toBe("announcement");
    expect(args.update.value.title).toBe("Maintenance");
  });

  it("forces disabled when the title is empty", async () => {
    const stored = await writeAnnouncement({
      enabled: true, tone: "warning", title: "", body: null, pauseCheckout: false,
    });
    expect(stored.enabled).toBe(false);
  });

  it("upserts so the draft survives being turned off", async () => {
    await writeAnnouncement({ enabled: false, tone: "info", title: "Draft", body: null, pauseCheckout: false });
    expect(prisma.appSetting.upsert).toHaveBeenCalledOnce();
  });
});

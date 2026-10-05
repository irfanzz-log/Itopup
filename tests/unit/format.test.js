import { describe, it, expect } from "vitest";
import {
  formatIDR,
  formatNumber,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  maskEmail,
  maskTail,
  initials,
} from "../../src/lib/format.js";

// Regression: these helpers rendered differently on the server and in the
// browser, which made React throw
//
//   "Hydration failed because the server rendered text didn't match the client"
//
// on every nominal button of /topup/*. The root cause was `Intl.NumberFormat`
// with a currency style: Node's ICU emits "Rp 1.600" (with a non-breaking
// space) while the browser emitted "Rp1.600". The fix assembles the string by
// hand, so the tests below pin the EXACT bytes rather than a locale-dependent
// shape.
describe("formatIDR / formatNumber — deterministic grouping", () => {
  it("renders the exact string the hydration diff complained about", () => {
    // The literal from the React error: server "Rp 1.600", client "Rp1.600".
    expect(formatIDR(1600)).toBe("Rp 1.600");
    // No non-breaking space, no narrow no-break space: a plain U+0020.
    expect(formatIDR(1600)).not.toMatch(/[\u00a0\u202f]/);
    expect(formatIDR(1600).charCodeAt(2)).toBe(0x20);
  });

  it("groups every three digits with a dot", () => {
    expect(formatIDR(1000)).toBe("Rp 1.000");
    expect(formatIDR(8800)).toBe("Rp 8.800");
    expect(formatIDR(108800)).toBe("Rp 108.800");
    expect(formatIDR(2722900)).toBe("Rp 2.722.900");
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(0)).toBe("0");
  });

  it("never emits NaN for a non-numeric amount", () => {
    // An instruction reading "Rp NaN" looks like a legitimate amount.
    for (const bad of [undefined, null, "", "abc", NaN, Infinity]) {
      expect(formatIDR(bad)).toBe("-");
      expect(formatNumber(bad)).toBe("-");
    }
  });

  it("keeps the decimal part instead of truncating it", () => {
    // 0.7% rendered as "0%" would misstate a fee.
    expect(formatNumber(0.7)).toBe("0,7");
    expect(formatNumber(1.5)).toBe("1,5");
    expect(formatNumber(1234.56)).toBe("1.234,56");
  });

  it("handles negative amounts", () => {
    expect(formatNumber(-1500)).toBe("-1.500");
    expect(formatIDR(-1500)).toBe("Rp -1.500");
  });

  it("is stable across repeated calls (no locale/time dependence)", () => {
    const first = formatIDR(1600);
    for (let i = 0; i < 50; i++) expect(formatIDR(1600)).toBe(first);
  });
});

describe("date formatters — pinned to Asia/Jakarta", () => {
  it("renders the same string regardless of the host timezone", () => {
    const iso = "2026-09-26T00:30:00.000Z"; // 07:30 WIB
    const out = formatDateTime(iso);
    expect(out).toContain("2026");
    // Must not drift with the process timezone: 00:30Z is still 26 Sep in WIB.
    expect(out).toMatch(/26/);
    expect(formatDate(iso)).toMatch(/26/);
  });

  it("returns a dash for empty or invalid input", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDateTime("not-a-date")).toBe("-");
  });
});

describe("misc helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(null)).toBe("-");
  });

  it("masks all but the tail", () => {
    expect(maskTail("1234567890", 4)).toBe("******7890");
    expect(maskTail("12", 4)).toBe("12");
  });

  it("formats relative times with an explicit now", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    const at = (s) => formatRelative(new Date(now.getTime() - s), now.getTime());
    expect(at(30_000)).toBe("30 detik lalu");
    expect(at(5 * 60_000)).toBe("5 menit lalu");
    expect(at(3 * 3_600_000)).toBe("3 jam lalu");
    expect(at(4 * 86_400_000)).toBe("4 hari lalu");
  });

  it("formats future times as 'dalam ...'", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    const out = formatRelative(new Date(now.getTime() + 10 * 60_000), now.getTime());
    expect(out).toBe("dalam 10 menit");
  });

  it("returns a dash for empty/invalid relative input", () => {
    expect(formatRelative(null)).toBe("-");
    expect(formatRelative("not-a-date")).toBe("-");
  });

  it("masks emails for display", () => {
    // The local part keeps 2 visible chars and ALWAYS at least 2 mask chars,
    // so a 1-char local is "a**", not "a*" (which would reveal its length).
    expect(maskEmail("budi@mail.com")).toBe("bu**@mail.com");
    expect(maskEmail("a@mail.com")).toBe("a**@mail.com");
  });

  it("returns a dash for invalid email input", () => {
    expect(maskEmail("not-an-email")).toBe("-");
    expect(maskEmail(null)).toBe("-");
  });

  it("takes the first letters of a name", () => {
    expect(initials("Budi Pratama")).toBe("BP");
    expect(initials("  Irfan  ")).toBe("I");
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});

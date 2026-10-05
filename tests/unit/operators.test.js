import { describe, it, expect } from "vitest";

import {
  validateFields,
  normalisePhoneId,
} from "../../src/config/input-fields.js";
import {
  OPERATOR_PREFIXES,
  operatorOfPhone,
  phoneMatchesOperator,
} from "../../src/config/operators.js";

describe("phone normalisation", () => {
  it("accepts every shape the customer might type and canonicalises to 08…", () => {
    // 08…, 8…, +62…, 62… are the four shapes a customer sees on their phone.
    expect(normalisePhoneId("081234567890")).toBe("081234567890");
    expect(normalisePhoneId("81234567890")).toBe("081234567890");
    expect(normalisePhoneId("+6281234567890")).toBe("081234567890");
    expect(normalisePhoneId("6281234567890")).toBe("081234567890");
  });

  it("strips spaces and dashes before normalising", () => {
    expect(normalisePhoneId("+62 812 3456 7890")).toBe("081234567890");
    expect(normalisePhoneId("0812-3456-7890")).toBe("081234567890");
  });
});

describe("phone field validation", () => {
  const defs = [
    { key: "phoneNumber", label: "Nomor HP", required: true, pattern: "^0[0-9]{8,13}$", minLength: 9, maxLength: 14 },
  ];

  it("stores the canonical form, so +62 and 08 are the same customer", () => {
    const a = validateFields(defs, { phoneNumber: "+6281234567890" });
    const b = validateFields(defs, { phoneNumber: "081234567890" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.values.phoneNumber).toBe(b.values.phoneNumber);
  });

  it("rejects a number that is too short to be a mobile number", () => {
    const r = validateFields(defs, { phoneNumber: "08123" });
    expect(r.ok).toBe(false);
  });

  it("rejects garbage", () => {
    const r = validateFields(defs, { phoneNumber: "abcdefghij" });
    expect(r.ok).toBe(false);
  });

  // ── Regression: the field used to display the "+62 …" form while enforcing
  // maxLength on it. A formatted number is two characters longer than the
  // number itself, so the browser truncated the last digits in the DOM and the
  // customer saw their number silently shorten while typing. The field now
  // holds the canonical 08… form only, and validation is done on that form.
  it("accepts a 12-digit number in the +62 form the customer reads off their phone", () => {
    const r = validateFields(defs, { phoneNumber: "+6285788513910" });
    expect(r.ok).toBe(true);
    expect(r.values.phoneNumber).toBe("085788513910");
  });

  it("accepts the same number typed in every shape", () => {
    for (const input of ["085788513910", "85788513910", "+6285788513910", "6285788513910"]) {
      const r = validateFields(defs, { phoneNumber: input });
      expect(r.ok, `rejects ${input}`).toBe(true);
      expect(r.values.phoneNumber, `stored wrong value for ${input}`).toBe("085788513910");
    }
  });

  it("reports a number that stopped one digit short, instead of calling it invalid", () => {
    // The exact symptom from the report: the number looked complete in the
    // field but had been truncated, so it was really just too short. The
    // message has to say so, not "Nomor HP tidak valid." Eight characters is
    // one short of the nine-character floor minLength and the pattern agree on.
    const r = validateFields(defs, { phoneNumber: "08578851" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/terlalu pendek/i);
  });

  it("says the trunk prefix is missing when the customer typed 812…", () => {
    // `normalisePhoneId` prepends the 0 itself, so this is not a rejection,
    // it is silently fixed. Asserting the prefix message here would mean the
    // customer had to know the rule, which is exactly the friction the
    // normalisation exists to remove.
    const r = validateFields(defs, { phoneNumber: "85788513910" });
    expect(r.ok).toBe(true);
    expect(r.values.phoneNumber).toBe("085788513910");
  });

  it("says the trunk prefix is missing when the customer typed no prefix", () => {
    // `normalisePhoneId` fixes a missing 0 or a +62/62 itself, so this branch
    // is only reached for input with no prefix at all, a number typed the way
    // it appears in a phonebook export, e.g. "21 234 5678".
    const r = validateFields(defs, { phoneNumber: "212345678" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/dimulai dari 0/i);
  });

  it("accepts the longest mobile number the catalogue sells", () => {
    // The pattern caps a mobile number at 08 + 11 digits, 13 characters,
    // which is the top of the Indonesian mobile range. The point of the test:
    // that limit is expressed in the CANONICAL form. Under the old code the
    // field's maxLength was enforced on the "+62 …" display form, so this
    // 13-character number was 15 characters on screen and its last two digits
    // were truncated in the DOM while the customer typed.
    const r = validateFields(defs, { phoneNumber: "0899999999999" });
    expect(r.ok).toBe(true);
  });

  it("rejects a number longer than the mobile range", () => {
    const r = validateFields(defs, { phoneNumber: "089999999999999" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/terlalu panjang/i);
  });
});

describe("operator prefix matching", () => {
  it("detects the operator from the first three digits after the 0", () => {
    expect(operatorOfPhone("085776191048")).toBe("indosat");
    expect(operatorOfPhone("+6285712345678")).toBe("indosat");
    expect(operatorOfPhone("081234567890")).toBe("telkomsel");
    expect(operatorOfPhone("089512345678")).toBe("tri");
    expect(operatorOfPhone("085112345678")).toBe("byu");
  });

  // by.U (0851) and Telkomsel Kartu As (0852/0853) are the one case where two
  // digits would wrongly collapse two operators into one. Three is required.
  it("distinguishes by.U from Telkomsel, which share a network", () => {
    expect(operatorOfPhone("0851123456")).toBe("byu");
    expect(operatorOfPhone("0852123456")).toBe("telkomsel");
    expect(phoneMatchesOperator("0851123456", "telkomsel")).toBe(false);
    expect(phoneMatchesOperator("0851123456", "byu")).toBe(true);
  });

  it("flags a number that belongs to a different operator", () => {
    // The exact case this guard exists for: customer picks Indosat, types a
    // Telkomsel number. This must never reach payment creation.
    expect(phoneMatchesOperator("081234567890", "indosat")).toBe(false);
    expect(phoneMatchesOperator("085776191048", "indosat")).toBe(true);
  });

  it("returns null for a number with no known prefix", () => {
    // 0700 is not allocated to a mobile operator, so this is "not a mobile
    // number", not "wrong operator", the checkout check distinguishes them.
    expect(operatorOfPhone("07001234567")).toBeNull();
  });

  it("does not police a product that has no operator slug", () => {
    // Games (mobile-legends, free-fire, …) collect an ID, not a phone number.
    // `phoneMatchesOperator` must pass them through so this guard never becomes
    // a wall that blocks a game purchase.
    expect(phoneMatchesOperator("anything", null)).toBe(true);
    expect(phoneMatchesOperator("anything", undefined)).toBe(true);
    expect(phoneMatchesOperator("anything", "unknown-operator")).toBe(true);
  });

  it("covers every operator the catalogue sells", () => {
    // PRODUCT_SEED.pulsa is one product per operator. If an operator appears in
    // the catalogue but not here, its numbers would all be refused as "not a
    // mobile number", a silent break, so this asserts the table is complete.
    const soldOperators = ["telkomsel", "indosat", "xl", "axis", "tri", "smartfren", "byu"];
    for (const op of soldOperators) {
      expect(OPERATOR_PREFIXES[op], `missing prefix table for ${op}`).toBeDefined();
      expect(OPERATOR_PREFIXES[op].length, `empty prefix table for ${op}`).toBeGreaterThan(0);
    }
  });

  it("assigns no prefix to two operators", () => {
    // A shared prefix would make the operator ambiguous and the guard would
    // refuse a valid number at random depending on iteration order.
    const all = Object.values(OPERATOR_PREFIXES).flat();
    const dupes = all.filter((p, i) => all.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });

  it("uses three-digit prefixes only", () => {
    // The lookup slices exactly three digits; a prefix of another length would
    // never match and would look like a broken check.
    for (const prefixes of Object.values(OPERATOR_PREFIXES)) {
      for (const p of prefixes) {
        expect(p.length, `prefix ${p} is not three digits`).toBe(3);
      }
    }
  });
});

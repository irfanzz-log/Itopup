// The credential field contract: what a `needsGameLogin` game sends to the
// provider, and, the point of the whole feature, that a secret is never
// carried in a place it could be persisted from.
import { describe, it, expect } from "vitest";

import {
  FIELD_PRESETS,
  validateFields,
  secretFieldKeys,
  isSecretField,
} from "../../src/config/input-fields.js";
import {
  mapFieldsToProvider,
  PRIMARY_TARGET_FIELD,
  ZONE_TARGET_FIELD,
} from "../../src/providers/melostore/mapper.js";

describe("credential field contract", () => {
  it("marks the game password as a secret", () => {
    expect(isSecretField(FIELD_PRESETS.gamePassword)).toBe(true);
    expect(isSecretField(FIELD_PRESETS.gameLogin)).toBe(false);
    expect(isSecretField(FIELD_PRESETS.userId)).toBe(false);
  });

  it("validates a secret without returning it", () => {
    const defs = [FIELD_PRESETS.gameLogin, FIELD_PRESETS.gamePassword];

    const result = validateFields(defs, {
      gameLogin: "player@example.com",
      gamePassword: "the-secret",
    });

    expect(result.ok).toBe(true);
    // The login comes back; the password validated but is absent.
    expect(result.values.gameLogin).toBe("player@example.com");
    expect(result.values).not.toHaveProperty("gamePassword");
  });

  it("still reports a missing or malformed secret", () => {
    const defs = [FIELD_PRESETS.gameLogin, FIELD_PRESETS.gamePassword];

    const missing = validateFields(defs, { gameLogin: "player@example.com" });
    expect(missing.ok).toBe(false);
    expect(missing.errors[0].field).toBe("gamePassword");

    const tooShort = validateFields(defs, {
      gameLogin: "player@example.com",
      gamePassword: "",
    });
    expect(tooShort.ok).toBe(false);
  });

  it("lists exactly the secret keys a game declares", () => {
    expect(secretFieldKeys([FIELD_PRESETS.gameLogin, FIELD_PRESETS.gamePassword])).toEqual([
      "gamePassword",
    ]);
    expect(secretFieldKeys([FIELD_PRESETS.userId, FIELD_PRESETS.zoneId])).toEqual([]);
    expect(secretFieldKeys([])).toEqual([]);
    expect(secretFieldKeys(null)).toEqual([]);
  });
});

describe("eFootball dispatch payload", () => {
  // The field contract the eFootball seed declares.
  const defs = [FIELD_PRESETS.gameLogin, FIELD_PRESETS.gamePassword];

  it("places the login in customer_target and the secret in customer_target_zone", () => {
    const out = mapFieldsToProvider({
      gameSlug: "efootball",
      fields: { gameLogin: "player@example.com", gamePassword: "the-secret" },
    });

    // The provider's own inquiry form is {target: "Login", zone: "Password"}.
    expect(out.customer_target).toBe("player@example.com");
    expect(out.customer_target_zone).toBe("the-secret");
  });

  it("does not duplicate the secret into additional_data", () => {
    const out = mapFieldsToProvider({
      gameSlug: "efootball",
      fields: { gameLogin: "player@example.com", gamePassword: "the-secret" },
    });

    expect(out.additional_data).toBeUndefined();
  });

  it("throws when the login is missing", () => {
    expect(() =>
      mapFieldsToProvider({ gameSlug: "efootball", fields: { gamePassword: "the-secret" } })
    ).toThrow(/gameLogin/);
  });

  it("is registered in the primary and zone target tables", () => {
    // The contract test in melostore.mapper.test.js already requires every game
    // to be in PRIMARY_TARGET_FIELD; this asserts the eFootball entry points at
    // the field its own form declares.
    expect(PRIMARY_TARGET_FIELD.efootball).toBe("gameLogin");
    expect(ZONE_TARGET_FIELD.efootball).toBe("gamePassword");
  });

  it("sends the payload exactly once", () => {
    // Two encryptions of the same secret must not both land in the request:
    // a credential duplicated across slots is a leak for no benefit.
    const out = mapFieldsToProvider({
      gameSlug: "efootball",
      fields: { gameLogin: "player@example.com", gamePassword: "the-secret" },
    });

    const json = JSON.stringify(out);
    expect(json.match(/the-secret/g)?.length).toBe(1);
  });
});

describe("games without a login are unchanged", () => {
  it("keeps the classic userId + zoneId pairing", () => {
    const out = mapFieldsToProvider({
      gameSlug: "mobile-legends",
      fields: { userId: "123456789", zoneId: "2039" },
    });

    expect(out.customer_target).toBe("123456789");
    expect(out.customer_target_zone).toBe("2039");
    expect(out.additional_data).toBeUndefined();
  });

  it("treats zoneId as the zone slot when a game declares no override", () => {
    expect(ZONE_TARGET_FIELD["mobile-legends"]).toBeUndefined();
    expect(ZONE_TARGET_FIELD["free-fire"]).toBeUndefined();
  });
});

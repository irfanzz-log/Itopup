// The credential checkout chain, against the real database:
//
//   customer request (with login + password)
//     → validateFields drops the secret from customerInput
//     → saveGameCredential stores an AES-256-GCM ciphertext
//     → the order row keeps only credentialId
//     → resolveForDispatch decrypts and shapes the provider payload
//
// The assertions that matter: no plaintext in the order row, no plaintext in
// the credential row, and the provider payload carries both login and secret.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { prisma } from "../../src/lib/db.js";
import {
  saveGameCredential,
  resolveForDispatch,
} from "../../src/services/credential.service.js";
import { validateFields, FIELD_PRESETS } from "../../src/config/input-fields.js";
import { mapFieldsToProvider } from "../../src/providers/melostore/mapper.js";

const GAME_SLUG = "efootball-credential-test";
const SECRET = "never-stored-plaintext-2026";

let user, game;

describe("game credential checkout chain", () => {
  beforeEach(async () => {
    // Clear leftovers from a previously failed run. ORDER MATTERS now that the
    // FK exists: an order references a credential, so the orders go first or
    // NO ACTION blocks the rest and every test fails on setup, not on code.
    await prisma.order.deleteMany({
      where: { credential: { game: { slug: GAME_SLUG } } },
    });
    await prisma.gameCredential.deleteMany({ where: { game: { slug: GAME_SLUG } } });
    await prisma.game.deleteMany({ where: { slug: GAME_SLUG } }).catch(() => {});

    user = await prisma.user.create({
      data: {
        email: `cred-${Date.now()}@itopup.test`,
        name: "Credential Test User",
        passwordHash: "not-a-real-hash",
        role: "MEMBER",
      },
    });

    game = await prisma.game.create({
      data: {
        slug: GAME_SLUG,
        name: "Credential Test Game",
        category: { connectOrCreate: { where: { slug: "game" }, create: { slug: "game", name: "Game", kind: "GAME", isActive: true } } },
        logo: "efootball",
        inputFields: [FIELD_PRESETS.gameLogin, FIELD_PRESETS.gamePassword],
        needsGameLogin: true,
        supportsValidation: false,
        isActive: true,
        sortOrder: 999,
      },
    });
  });

  afterAll(async () => {
    // Orders reference credentials, so remove them FIRST: the FK is NO ACTION,
    // and a credential left referenced by an order would block its own removal.
    if (user) await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.gameCredential.deleteMany({ where: { game: { slug: GAME_SLUG } } });
    if (game) await prisma.game.deleteMany({ where: { slug: GAME_SLUG } });
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  it("stores a credential and decrypts it only at dispatch", async () => {
    const stored = await saveGameCredential({
      userId: user.id,
      gameId: game.id,
      login: "player@example.com",
      secret: SECRET,
    });

    // The login is a plaintext identifier (see the schema doc: it identifies
    // the account without granting access). The SECRET is what must never
    // appear, in the row or in any JSON serialisation of it.
    expect(stored.login).toBe("player@example.com");
    expect(JSON.stringify(stored)).not.toContain(SECRET);

    // And it resolves back to the original pair for the one provider call.
    const resolved = await resolveForDispatch({ userId: user.id, credentialId: stored.id });
    expect(resolved.login).toBe("player@example.com");
    expect(resolved.secret).toBe(SECRET);
  });

  it("upserts per user+game instead of stacking duplicate rows", async () => {
    await saveGameCredential({
      userId: user.id,
      gameId: game.id,
      login: "player@example.com",
      secret: "first-secret",
    });
    const second = await saveGameCredential({
      userId: user.id,
      gameId: game.id,
      login: "player@example.com",
      secret: "rotated-secret",
    });

    const count = await prisma.gameCredential.count({
      where: { userId: user.id, gameId: game.id },
    });
    expect(count).toBe(1);
    const back = await resolveForDispatch({ userId: user.id, credentialId: second.id });
    expect(back.secret).toBe("rotated-secret");
  });

  it("never writes the secret into the order row", async () => {
    // validateFields is the boundary the order row is built from.
    const validated = validateFields(game.inputFields, {
      gameLogin: "player@example.com",
      gamePassword: SECRET,
    });

    expect(validated.ok).toBe(true);
    expect(validated.values).not.toHaveProperty("gamePassword");
    expect(JSON.stringify(validated.values)).not.toContain(SECRET);

    const credential = await saveGameCredential({
      userId: user.id,
      gameId: game.id,
      login: "player@example.com",
      secret: SECRET,
    });

    const order = await prisma.order.create({
      data: {
        invoice: `IT-CRED-${Date.now()}`,
        userId: user.id,
        credentialId: credential.id,
        customerInput: validated.values,
        gameName: game.name,
        productName: "Coins",
        variantName: "130 Coins",
        unitCostPrice: 1000,
        unitSellingPrice: 1000,
        subtotal: 1000,
        total: 1000,
        idempotencyKey: `test-key-${Date.now()}`,
        requestHash: "sha256-of-a-redacted-request",
      },
    });

    const reloaded = await prisma.order.findUnique({
      where: { id: order.id },
      include: { credential: true },
    });

    expect(reloaded.credentialId).toBe(credential.id);
    expect(reloaded.customerInput).not.toHaveProperty("gamePassword");
    expect(JSON.stringify(reloaded.customerInput)).not.toContain(SECRET);
    // The relation resolves, and even the encrypted blob is not the plaintext.
    expect(JSON.stringify(reloaded.credential)).not.toContain(SECRET);
  });

  it("shapes the provider payload exactly as the inquiry form asks", async () => {
    const credential = await saveGameCredential({
      userId: user.id,
      gameId: game.id,
      login: "player@example.com",
      secret: SECRET,
    });
    const resolved = await resolveForDispatch({ userId: user.id, credentialId: credential.id });

    // The contract's field keys are what mapFieldsToProvider reads; the
    // credential service returns {login, secret}, so translate to the contract.
    const payload = mapFieldsToProvider({
      gameSlug: "efootball",
      fields: { gameLogin: resolved.login, gamePassword: resolved.secret },
    });

    // The provider's own inquiry form is { target: "Login", zone: "Password" }.
    expect(payload.customer_target).toBe("player@example.com");
    expect(payload.customer_target_zone).toBe(SECRET);
    expect(payload.additional_data).toBeUndefined();

    // Exactly one occurrence, the secret must not be duplicated across slots.
    expect(JSON.stringify(payload).match(new RegExp(SECRET, "g"))?.length).toBe(1);
  });

  it("refuses to resolve a credential that does not exist", async () => {
    await expect(
      resolveForDispatch({
        userId: user.id,
        credentialId: "00000000-0000-4000-8000-000000000000",
      })
    ).rejects.toThrow();
  });

  it("refuses to delete a credential an order still references", async () => {
    const credential = await saveGameCredential({
      userId: user.id,
      gameId: game.id,
      login: "player@example.com",
      secret: SECRET,
    });

    await prisma.order.create({
      data: {
        invoice: `IT-CRED-${Date.now()}`,
        userId: user.id,
        credentialId: credential.id,
        customerInput: { gameLogin: "player@example.com" },
        gameName: game.name,
        productName: "Coins",
        variantName: "130 Coins",
        unitCostPrice: 1000,
        unitSellingPrice: 1000,
        subtotal: 1000,
        total: 1000,
        idempotencyKey: `test-key-${Date.now()}`,
        requestHash: "sha256-of-a-redacted-request",
      },
    });

    // The FK is ON DELETE NO ACTION: history is not rewritten when a customer
    // removes a stored login that an order already used. This is the database
    // refusing it, not the service layer deciding to.
    await expect(
      prisma.gameCredential.delete({ where: { id: credential.id } })
    ).rejects.toThrow();

    // The credential survived, so dispatch can still resolve it.
    const back = await resolveForDispatch({ userId: user.id, credentialId: credential.id });
    expect(back.login).toBe("player@example.com");
  });

});

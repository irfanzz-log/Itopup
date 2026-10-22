// ============================================================================
// Stored game logins must be listable by the identifier the UI actually has.
//
// THE BUG THIS PINS
//
// GET /api/member/credentials?gameSlug=<slug> called
// listGameCredentials({ userId, gameSlug }), but the service only read
// `gameId` and returned [] when it was absent. Every call therefore returned
// an empty list, so a returning customer could never see (or pick) a login they
// had previously saved — the feature was dead in the UI while the API answered
// 200.
//
// These tests run against the real test database (tests/setup.js truncates it),
// because the defect was in the query, not in a pure function.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { prisma } from "../../src/lib/db.js";
import {
  listGameCredentials,
  saveGameCredential,
  deleteGameCredential,
} from "../../src/services/credential.service.js";

let userId;
let otherUserId;
let gameId;
let otherGameId;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "Credential Owner", email: "cred-owner@test.local", passwordHash: "x" },
  });
  const other = await prisma.user.create({
    data: { name: "Credential Other", email: "cred-other@test.local", passwordHash: "x" },
  });
  userId = user.id;
  otherUserId = other.id;

  const category = await prisma.category.create({
    data: { kind: "GAME", name: "Game", slug: "cred-cat" },
  });

  const game = await prisma.game.create({
    data: { categoryId: category.id, name: "Cred Game", slug: "cred-game", needsGameLogin: true },
  });
  const otherGame = await prisma.game.create({
    data: { categoryId: category.id, name: "Cred Game 2", slug: "cred-game-2", needsGameLogin: true },
  });
  gameId = game.id;
  otherGameId = otherGame.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listGameCredentials", () => {
  it("returns the user's logins when called with a gameId", async () => {
    await saveGameCredential({ userId, gameId, login: "by-id@example.test", secret: "rahasia-1" });

    const rows = await listGameCredentials({ userId, gameId });
    expect(rows.map((r) => r.login)).toContain("by-id@example.test");
  });

  it("returns the same rows when called with a gameSlug (the regression)", async () => {
    // This is the exact shape the route uses.
    const bySlug = await listGameCredentials({ userId, gameSlug: "cred-game" });
    const byId = await listGameCredentials({ userId, gameId });

    expect(bySlug.length).toBeGreaterThan(0);
    expect(bySlug.map((r) => r.id).sort()).toEqual(byId.map((r) => r.id).sort());
  });

  it("never returns another user's logins, by slug or by id", async () => {
    await saveGameCredential({ userId: otherUserId, gameId, login: "other@example.test", secret: "rahasia-2" });

    const bySlug = await listGameCredentials({ userId, gameSlug: "cred-game" });
    expect(bySlug.map((r) => r.login)).not.toContain("other@example.test");
  });

  it("does not mix games", async () => {
    await saveGameCredential({ userId, gameId: otherGameId, login: "second-game@example.test", secret: "rahasia-3" });

    const rows = await listGameCredentials({ userId, gameSlug: "cred-game-2" });
    expect(rows.map((r) => r.login)).toEqual(["second-game@example.test"]);
  });

  it("returns an empty list for an unknown slug instead of throwing", async () => {
    const rows = await listGameCredentials({ userId, gameSlug: "does-not-exist" });
    expect(rows).toEqual([]);
  });

  it("returns an empty list when neither identifier is supplied", async () => {
    expect(await listGameCredentials({ userId })).toEqual([]);
    expect(await listGameCredentials({})).toEqual([]);
  });

  it("never exposes the ciphertext or the IV in a listed row", async () => {
    const rows = await listGameCredentials({ userId, gameSlug: "cred-game" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("secretCipher");
      expect(row).not.toHaveProperty("secretIv");
      expect(Object.keys(row).sort()).toEqual(["createdAt", "id", "lastUsedAt", "login"].sort());
    }
  });
});

describe("deleteGameCredential", () => {
  it("refuses to delete another user's row and reports it as not found", async () => {
    const mine = await saveGameCredential({ userId, gameId, login: "delete-me@example.test", secret: "rahasia-4" });

    const deleted = await deleteGameCredential({ userId: otherUserId, credentialId: mine.id });
    expect(deleted).toBe(false);

    // Still there for its owner.
    const rows = await listGameCredentials({ userId, gameSlug: "cred-game" });
    expect(rows.map((r) => r.login)).toContain("delete-me@example.test");
  });

  it("deletes the owner's own row", async () => {
    const mine = await saveGameCredential({ userId, gameId, login: "gone@example.test", secret: "rahasia-5" });
    expect(await deleteGameCredential({ userId, credentialId: mine.id })).toBe(true);

    const rows = await listGameCredentials({ userId, gameSlug: "cred-game" });
    expect(rows.map((r) => r.login)).not.toContain("gone@example.test");
  });
});

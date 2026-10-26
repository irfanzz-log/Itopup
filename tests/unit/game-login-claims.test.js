// ============================================================================
// "Never asks for your game password" must not be printed where it is false.
//
// THE BUG THIS PINS
//
// Five places stated, unconditionally, that ITOPUP never asks for a game
// password: the /bantuan FAQ, the homepage advantage card, the login/register
// sidebar, the game page's own feature list, and (ambiguously) the profile
// page. Meanwhile two services in the catalogue — eFootball and Roblox — ask
// for exactly that, because their provider's inquiry form is
// {target: Login, zone: Password}.
//
// The worst instance was the GAME PAGE: eFootball's own page printed
// "Tanpa login akun game" directly above a form asking for the game password.
// A customer reading that has been told their password will never be requested
// immediately before being asked for it, which is worse than saying nothing.
//
// These tests assert the CLAIM IS SCOPED and that the per-game page branches on
// the game's real contract rather than on a hardcoded slug.
// ============================================================================
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { GAME_SEED } from "@/config/games.js";

/** Every unconditional version of the claim, as it appeared before the fix. */
const BLANKET_CLAIMS = [
  "tidak pernah meminta password akun game",
  "Tidak. ITOPUP hanya membutuhkan User ID / Player ID",
  "Tanpa login akun game",
];

describe("the catalogue really does have both contracts", () => {
  // Without this, the rest of the file could pass on a catalogue where the
  // contradiction cannot exist, and would stop guarding anything.
  it("has services that need a game login", () => {
    const loginGames = GAME_SEED.filter((game) => game.needsGameLogin);
    expect(loginGames.length).toBeGreaterThan(0);
    for (const game of loginGames) {
      const secrets = (game.inputFields ?? []).filter((f) => f.secret);
      expect(secrets.length).toBeGreaterThan(0);
    }
  });

  it("and services that do not", () => {
    expect(GAME_SEED.filter((game) => !game.needsGameLogin).length).toBeGreaterThan(0);
  });
});

describe("/bantuan FAQ", () => {
  it("scopes the answer to the service instead of saying 'no'", async () => {
    const mod = await import("../../src/app/bantuan/page.jsx");
    const html = renderToStaticMarkup(React.createElement(mod.default));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    expect(text).toContain("Tergantung layanannya");
    // The blanket sentence must be gone.
    expect(text.toLowerCase()).not.toContain("kami tidak pernah meminta password akun game");
    // And it must say what actually happens to a game password.
    expect(text).toContain("terenkripsi");
  });

  it("keeps the FAQ schema in step with the visible answer", async () => {
    const mod = await import("../../src/app/bantuan/page.jsx");
    const html = renderToStaticMarkup(React.createElement(mod.default));
    const body = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(body).toBeTruthy();
    const schema = JSON.parse(body[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
    const answer = schema.mainEntity.find((q) => /perlu akun game/i.test(q.name));
    expect(answer).toBeTruthy();
    expect(answer.acceptedAnswer.text).toContain("Tergantung layanannya");
  });
});

describe("homepage advantage card", () => {
  it("no longer claims a blanket 'never'", async () => {
    const mod = await import("../../src/app/page.jsx");
    // The advantage list is module-level data on a server page; rendering the
    // whole homepage needs a database, so assert on the exported content via
    // the rendered markup only if it is cheap — otherwise the string check
    // below is the guard.
    expect(typeof mod.default).toBe("function");
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/app/page.jsx", import.meta.url), "utf8")
    );
    expect(source).not.toContain("Kami tidak pernah meminta password akun game");
    expect(source).toContain("Untuk sebagian besar layanan");
  });
});

describe("login / register sidebar", () => {
  it("scopes the trust point to 'most services'", async () => {
    const { default: AuthShell } = await import("../../src/components/auth/AuthShell.jsx");
    const html = renderToStaticMarkup(
      React.createElement(AuthShell, { title: "Masuk" }, React.createElement("div", null, "form"))
    );
    expect(html).toContain("Sebagian besar layanan cukup User ID");
    expect(html).not.toContain("Kami tidak pernah meminta password akun game Anda.");
  });
});

describe("per-game page", () => {
  it("branches the feature list on needsGameLogin, not on a slug", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      new URL("../../src/app/topup/[category]/[game]/page.jsx", import.meta.url),
      "utf8"
    );
    // The claim must be conditional...
    expect(source).toContain("game.needsGameLogin ?");
    expect(source).toContain("Perlu login akun game");
    // ...and must not be hardcoded to the two games that happen to need it now.
    expect(source).not.toMatch(/slug === "efootball"/);
    expect(source).not.toMatch(/slug === "roblox"/);
  });
});

describe("terms of service", () => {
  it("documents the game-credential store it previously ignored", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../../src/app/syarat/page.jsx", import.meta.url), "utf8");
    // Two services ask for a game password; the terms must say what happens to
    // it rather than only describing the ITOPUP account password.
    expect(source).toContain("password akun game");
    expect(source).toContain("AES-256-GCM");
    expect(source).toContain("tidak disimpan kecuali");
  });
});

describe("no page reintroduces the blanket claim", () => {
  it("is absent from every rendered source file", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = new URL("../../src/", import.meta.url);

    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const claim of BLANKET_CLAIMS) {
          if (text.includes(claim)) offenders.push(`${path.relative(root.pathname, full)}: ${claim}`);
        }
      }
    };
    walk(root.pathname);

    // "Tanpa login akun game" is allowed ONLY as the false branch of the
    // per-game conditional, which the assertion above pins separately. It
    // appears in JSX as a bare string literal inside the ternary, so the
    // allow-list matches on the surrounding conditional rather than on quotes.
    const real = offenders.filter((line) => {
      if (!line.includes("Tanpa login akun game")) return true;
      const source = fs.readFileSync(path.join(root.pathname, line.split(":")[0]), "utf8");
      return !source.includes('game.needsGameLogin ? "Perlu login akun game" : "Tanpa login akun game"');
    });
    expect(real).toEqual([]);
  });
});

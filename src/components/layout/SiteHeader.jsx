// ============================================================================
// Site header (server component).
//
// Resolves the session and the navigation data on the server, then hands plain
// objects to the client NavBar. Two consequences that matter:
//   * the signed-in UI never flashes for an anonymous visitor (the server simply
//     does not send `user`),
//   * the nav costs zero client requests.
//
// A failure to load navigation data must not take down every page, so the
// catalogue read is wrapped: an empty menu is a degraded header, not a 500.
// ============================================================================
import { currentUserOrNull } from "@/lib/auth/guards.js";
import { listGamesGrouped, listPopularGames } from "@/services/catalog.service.js";
import NavBar from "./NavBar";

export default async function SiteHeader() {
  const [user, categories, popularGames] = await Promise.all([
    currentUserOrNull(),
    listGamesGrouped().catch(() => []),
    listPopularGames(6).catch(() => []),
  ]);

  return (
    <NavBar
      user={
        user
          ? { id: user.id, name: user.name, email: user.email, role: user.role }
          : null
      }
      categories={categories}
      popularGames={popularGames}
    />
  );
}

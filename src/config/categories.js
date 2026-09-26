// ============================================================================
// Category catalogue.
//
// The DB `Category` table is the runtime source of truth (the admin can disable
// or reorder a category without a deploy). This file is the SEED source plus the
// URL-segment mapping, kept in one place so a route and its data can never
// disagree about what "e-wallet" is called.
// ============================================================================
import { CATEGORY_KIND, CATEGORY_KIND_PATH, CATEGORY_KIND_LABEL } from "../lib/constants.js";

/** @type {Array<{kind:string,name:string,slug:string,description:string,icon:string,sortOrder:number}>} */
export const CATEGORY_SEED = [
  {
    kind: CATEGORY_KIND.GAME,
    name: "Game",
    slug: CATEGORY_KIND_PATH.GAME,
    description: "Top up diamond, voucher, dan item game favoritmu.",
    icon: "gamepad",
    sortOrder: 1,
  },
  {
    kind: CATEGORY_KIND.PULSA,
    name: "Pulsa",
    slug: CATEGORY_KIND_PATH.PULSA,
    description: "Pulsa semua operator Indonesia, proses instan.",
    icon: "signal",
    sortOrder: 3,
  },
];

/** URL segment under /topup for a category kind, e.g. GAME → "game". */
export function categoryPath(kind) {
  return CATEGORY_KIND_PATH[kind] ?? "game";
}

/** Inverse of categoryPath — resolve a URL segment back to a kind. */
export function kindFromPath(segment) {
  const entry = Object.entries(CATEGORY_KIND_PATH).find(([, path]) => path === segment);
  return entry?.[0] ?? null;
}

/** Label for a category kind. Falls back to the raw value rather than "" — an
 *  unknown kind should look wrong, not blank. */
export function categoryLabel(kind) {
  return CATEGORY_KIND_LABEL[kind] ?? String(kind);
}

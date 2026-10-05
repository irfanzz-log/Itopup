// ============================================================================
// Authorization guards.
//
// These are the ONLY place "may this user do this" is decided. Proxy/edge
// checks are an optimistic redirect for UX; every route handler and every
// server component that reads or writes user data calls into here, because a
// matcher change can silently remove Proxy coverage from a path.
// ============================================================================
import { AppError } from "../errors.js";
import { getCurrentUser, getSessionUser } from "./session.js";

/** Role hierarchy: SUPERADMIN ⊃ DEV ⊃ MEMBER. */
export const ROLE_RANK = {
  MEMBER: 10,
  DEV: 20,
  SUPERADMIN: 30,
};

export function hasRole(user, roles) {
  if (!user) return false;
  const required = Array.isArray(roles) ? roles : [roles];
  const rank = ROLE_RANK[user.role] ?? 0;
  return required.some((role) => rank >= (ROLE_RANK[role] ?? Infinity));
}

/** Roles that may open the /dev area. */
export const STAFF_ROLES = ["DEV", "SUPERADMIN"];

/** Roles that may perform destructive or security-sensitive actions. */
export const SUPERADMIN_ROLES = ["SUPERADMIN"];

/**
 * Assert a user is present and usable. Blocked accounts are refused here, not
 * at login only; a member blocked mid-session must lose access immediately.
 */
export function assertUsable(user) {
  if (!user) throw new AppError("ITP_UNAUTHORIZED");
  if (user.status === "BLOCKED") throw new AppError("ITP_ACCOUNT_BLOCKED");
  return user;
}

/** Route-handler guard: require a signed-in, non-blocked user. */
export async function requireAuth(req) {
  const user = await getSessionUser(req);
  return assertUsable(user);
}

/** Route-handler guard: require a signed-in user with at least one of `roles`. */
export async function requireRole(req, roles) {
  const user = await requireAuth(req);
  if (!hasRole(user, roles)) throw new AppError("ITP_FORBIDDEN");
  return user;
}

/** Shorthand for the common staff check. */
export async function requireStaff(req) {
  return requireRole(req, STAFF_ROLES);
}

export async function requireSuperadmin(req) {
  return requireRole(req, SUPERADMIN_ROLES);
}

/**
 * Server-component variant: returns null instead of throwing, so a page can
 * decide between "redirect to login" and "render a signed-out view".
 */
export async function currentUserOrNull() {
  const user = await getCurrentUser();
  if (!user || user.status === "BLOCKED") return null;
  return user;
}

/** True when the caller may act on behalf of `ownerId` (self, or staff). */
export function canActOnUser(actor, ownerId) {
  if (!actor) return false;
  if (actor.id === ownerId) return true;
  return hasRole(actor, STAFF_ROLES);
}

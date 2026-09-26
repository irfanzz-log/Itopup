// ============================================================================
// Stub for the `server-only` package under Vitest.
//
// Next.js aliases `server-only` at build time so that importing it from a
// client component is a hard BUILD error — that is the real protection and it
// stays in place. Vitest has no such alias, so the import would fail to resolve
// in unit tests. This empty module is aliased in vitest.config.js only.
// ============================================================================
export {};

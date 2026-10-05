import { describe, it, expect } from "vitest";
import { prismaRetryExtension } from "../../src/lib/db.js";

// The retry extension decides whether a transient connection failure becomes a
// recovered page or a customer-facing 500. It was originally written against
// only the "Connection terminated" family, and the pool-exhaustion error
// ("timeout exceeded when trying to connect", Prisma P2024) slipped past it,
// observed as a 20.5s request and four hard errors on a cold dev start.
//
// This test never touches a database: it drives the extension's `$allOperations`
// with a fake Prisma `query` that fails a fixed number of times, which is
// enough to prove which messages are retried and which are not.

/**
 * Run the extension as Prisma would, against a `query` that throws `message`
 * for the first `failures` calls and then resolves `result`.
 * Returns the number of times the underlying query actually ran.
 */
function run({ message, failures = 1, operation = "findMany", result = { ok: true } }) {
  let calls = 0;
  const query = async () => {
    calls += 1;
    if (calls <= failures) {
      const error = new Error(message);
      error.clientVersion = "7.10.0";
      throw error;
    }
    return result;
  };
  const promise = prismaRetryExtension.query.$allOperations({
    operation,
    query,
    args: {},
  });
  return { promise, calls: () => calls };
}

const RETRYABLE = [
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
  "timeout exceeded when trying to connect",
  "Timed out fetching a new connection from the connection pool",
  "ConnectionError: could not connect",
  "Can't reach database server",
];

describe("itopupConnRetry", () => {
  it("retries every transient connection message once, then resolves", async () => {
    for (const message of RETRYABLE) {
      const { promise, calls } = run({ message, failures: 1 });
      await expect(promise).resolves.toEqual({ ok: true });
      expect(calls()).toBe(2);
    }
  });

  it("retries pool exhaustion (P2024) — the regression this file pins", async () => {
    // Before the fix these two messages were NOT retried, so they surfaced as
    // a hard 500 instead of a recovered request.
    for (const message of [
      "timeout exceeded when trying to connect",
      "Timed out fetching a new connection from the connection pool",
    ]) {
      const { promise, calls } = run({ message, failures: 1 });
      await expect(promise).resolves.toEqual({ ok: true });
      expect(calls()).toBe(2);
    }
  });

  it("gives up when the connection keeps failing", async () => {
    const { promise, calls } = run({
      message: "Connection terminated unexpectedly",
      failures: 5,
    });
    await expect(promise).rejects.toThrow("Connection terminated");
    // One attempt plus one retry, not five.
    expect(calls()).toBe(2);
  });

  it("does not retry a genuine query error", async () => {
    for (const message of [
      "Unknown argument `foo`",
      "Unique constraint failed on the fields: (id)",
      "Record to update not found",
      "Argument productId is missing",
    ]) {
      const { promise, calls } = run({ message, failures: 1 });
      await expect(promise).rejects.toThrow();
      expect(calls()).toBe(1);
    }
  });

  it("never retries a write, even on a retryable connection error", async () => {
    // Writes are not idempotent: a retry that lands twice would double-insert
    // or double-decrement. A transient failure on a write must surface rather
    // than be silently replayed.
    for (const operation of ["create", "update", "delete", "upsert"]) {
      const { promise, calls } = run({
        message: "Connection terminated unexpectedly",
        failures: 1,
        operation,
      });
      await expect(promise).rejects.toThrow("Connection terminated");
      expect(calls()).toBe(1);
    }
  });
});

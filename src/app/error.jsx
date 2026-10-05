"use client";

// ============================================================================
// Route-level error boundary.
//
// `error.message` is deliberately NOT rendered. In production Next replaces the
// message of a server error with a generic string, but in development it is the
// real one, which can contain a connection string, a table name, or a file
// path. The digest is shown instead: it correlates this page with the server log
// line, which is where the detail belongs.
// ============================================================================
import { useEffect } from "react";

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    // Report to the console only; no third-party error tracker is wired up yet.
    console.error("[itopup] route error", error?.digest || error?.message);
  }, [error]);

  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-foreground sm:text-2xl">Terjadi kesalahan</h1>
      <p className="mt-2 max-w-md text-sm text-foreground-muted">
        Halaman ini gagal dimuat. Silakan coba lagi. Jika masalah berlanjut, hubungi
        dukungan ITOPUP.
      </p>
      {error?.digest ? (
        <p className="mt-3 rounded-md bg-surface-muted px-3 py-1.5 font-mono text-xs text-foreground-subtle">
          Kode kesalahan: {error.digest}
        </p>
      ) : null}
      <button type="button" onClick={reset} className="btn-primary mt-6">
        Coba lagi
      </button>
    </div>
  );
}

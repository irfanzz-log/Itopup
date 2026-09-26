// ============================================================================
// /login
//
// The page itself is a server component so it can:
//   * redirect an already-signed-in visitor away (a logged-in member landing on
//     /login is almost always a stale tab),
//   * read `?registered=1` and show a success notice,
//   * render the client form inside a Suspense boundary, which
//     useSearchParams() requires.
// ============================================================================
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import LoginForm from "@/components/auth/LoginForm";
import { Alert, Skeleton } from "@/components/ui/primitives";
import { currentUserOrNull } from "@/lib/auth/guards.js";
import { safeNextPathServer } from "@/lib/redirect.js";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Masuk",
  description: "Masuk ke akun ITOPUP untuk melakukan top up dan melihat riwayat transaksi.",
  robots: { index: false, follow: true },
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const nextPath = safeNextPathServer(params?.next);

  const user = await currentUserOrNull();
  if (user) redirect(nextPath);

  return (
    <AuthShell
      title="Masuk ke ITOPUP"
      subtitle="Masuk untuk melanjutkan transaksi dan memantau status pesanan Anda."
    >
      {params?.registered === "1" ? (
        <div className="mb-5">
          <Alert tone="success" title="Akun berhasil dibuat">
            Silakan masuk menggunakan email dan password yang baru Anda daftarkan.
          </Alert>
        </div>
      ) : null}

      <Suspense fallback={<FormSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

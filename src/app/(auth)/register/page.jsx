// ============================================================================
// /register
// ============================================================================
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import RegisterForm from "@/components/auth/RegisterForm";
import GoogleButton from "@/components/auth/GoogleButton";
import { Skeleton } from "@/components/ui/primitives";
import { currentUserOrNull } from "@/lib/auth/guards.js";
import { safeNextPathServer } from "@/lib/redirect.js";
import { isGoogleEnabled } from "@/lib/google-oauth.js";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Daftar",
  description: "Buat akun ITOPUP gratis untuk top up game dan pulsa.",
  robots: { index: false, follow: true },
};

export default async function RegisterPage({ searchParams }) {
  const params = await searchParams;
  const nextPath = safeNextPathServer(params?.next);

  const user = await currentUserOrNull();
  if (user) redirect(nextPath);

  return (
    <AuthShell
      title="Daftar akun ITOPUP"
      subtitle="Gratis, tanpa biaya pendaftaran. Akun diperlukan untuk melakukan transaksi dan memantau status pesanan."
    >
      {isGoogleEnabled() ? (
        <>
          <GoogleButton nextPath={nextPath} enabled />
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-surface px-3 text-foreground-subtle">atau daftar dengan email</span>
            </div>
          </div>
        </>
      ) : null}

      <Suspense fallback={<FormSkeleton />}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

// ============================================================================
// /register
// ============================================================================
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import RegisterForm from "@/components/auth/RegisterForm";
import { Skeleton } from "@/components/ui/primitives";
import { currentUserOrNull } from "@/lib/auth/guards.js";
import { safeNextPathServer } from "@/lib/redirect.js";

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

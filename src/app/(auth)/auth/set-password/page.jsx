// ============================================================================
// /auth/set-password
//
// Shown only when a Google sign-in resolved to a local account that has no
// password yet. The identity is bound to the `itp_oauth_ticket` cookie, set by
// the Google callback; the page never trusts a query parameter for it.
// ============================================================================
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import SetPasswordForm from "@/components/auth/SetPasswordForm";
import { Skeleton } from "@/components/ui/primitives";
import { safeNextPathServer } from "@/lib/redirect.js";
import { cookies } from "next/headers";
import { verifyTicketForPage } from "@/lib/google-oauth.js";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Buat password",
  description: "Buat password untuk akun ITOPUP Anda.",
  robots: { index: false, follow: true },
};

export default async function SetPasswordPage({ searchParams }) {
  const params = await searchParams;
  const nextPath = safeNextPathServer(params?.next);

  // The ticket is the only proof this page should render at all. Without it,
  // the member has not completed the Google side, and there is nothing to set.
  const jar = await cookies();
  const ticket = jar.get("itp_oauth_ticket")?.value ?? null;

  if (!ticket) {
    redirect(`/login?google_error=missing`);
  }

  const profile = await verifyTicketForPage(ticket);
  if (!profile) {
    redirect(`/login?google_error=state`);
  }

  return (
    <AuthShell
      title="Buat password untuk akun Anda"
      subtitle="Email Anda sudah diverifikasi melalui Google. Buat password untuk menyelesaikan pendaftaran — akun ini bisa Anda akses dengan Google maupun password."
    >
      <Suspense fallback={<FormSkeleton />}>
        <SetPasswordForm name={profile.name} email={profile.email} nextPath={nextPath} />
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

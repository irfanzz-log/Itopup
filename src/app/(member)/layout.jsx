// ============================================================================
// /member layout — the REAL authorization gate for the member area.
//
// src/proxy.js only checks that a cookie EXISTS. This layout is what actually
// verifies it against the database and refuses blocked accounts, and it runs
// before any member markup is streamed. A client-side check would ship the
// shell and the data fetch first, which is cosmetic security.
//
// Two distinct outcomes, deliberately different:
//   * no session            → redirect to /login with the intended path,
//   * blocked account       → render a refusal page, NOT a redirect loop. A
//                             blocked member who is bounced to /login and can
//                             log in successfully would loop forever.
// ============================================================================
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session.js";
import { Alert } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function MemberLayout({ children }) {
  const user = await getCurrentUser();

  if (!user) {
    // The redirect happens before any children render, so an anonymous request
    // gets a 307 and never sees the member shell.
    redirect("/login?next=/member");
  }

  if (user.status === "BLOCKED") {
    return (
      <div className="container-page py-14">
        <div className="mx-auto max-w-lg">
          <Alert tone="danger" title="Akun Anda diblokir">
            <p>
              Akses ke area member ditangguhkan. Jika Anda merasa ini sebuah kesalahan,
              hubungi dukungan ITOPUP dan sebutkan email akun Anda.
            </p>
            {user.blockedReason ? (
              <p className="mt-2 text-xs opacity-90">Alasan: {user.blockedReason}</p>
            ) : null}
          </Alert>
          <div className="mt-5 flex gap-3">
            <Link href="/bantuan#kontak" className="btn-primary">Hubungi Dukungan</Link>
            <Link href="/" className="btn-secondary">Ke Beranda</Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

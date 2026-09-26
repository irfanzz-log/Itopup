// ============================================================================
// /dev layout — the REAL authorization gate for the staff area.
//
// Same reasoning as the member layout: src/proxy.js only checks that a cookie
// EXISTS, and a matcher change can silently drop coverage. This layout verifies
// the session against the database and checks the ROLE before any staff markup
// is streamed.
//
// Three distinct outcomes, deliberately different:
//   * no session      → redirect to /login with the intended path,
//   * blocked account → refusal page (a redirect would loop),
//   * signed in but not staff → 404-ish refusal, NOT a redirect to /login.
//     Bouncing a legitimate MEMBER to a login page they are already signed in
//     to is a loop, and it also confirms that /dev exists.
// ============================================================================
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session.js";
import { hasRole, STAFF_ROLES } from "@/lib/auth/guards.js";
import { Alert } from "@/components/ui/primitives";
import DevNav from "@/components/dev/DevNav";

export const dynamic = "force-dynamic";

export const metadata = {
  title: { default: "Developer", template: "%s · ITOPUP Dev" },
  robots: { index: false, follow: false },
};

export default async function DevLayout({ children }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/dev/dashboard");
  }

  if (user.status === "BLOCKED") {
    return (
      <div className="container-page py-14">
        <div className="mx-auto max-w-lg">
          <Alert tone="danger" title="Akun Anda diblokir">
            <p>Akses ke panel developer ditangguhkan.</p>
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

  if (!hasRole(user, STAFF_ROLES)) {
    // Deliberately a refusal, not a redirect: this user is signed in, and the
    // answer is "you are not staff", not "please sign in".
    return (
      <div className="container-page py-14">
        <div className="mx-auto max-w-lg">
          <Alert tone="warning" title="Akses ditolak">
            <p>
              Akun Anda tidak memiliki akses ke panel developer. Halaman ini hanya
              untuk staf ITOPUP.
            </p>
          </Alert>
          <div className="mt-5 flex gap-3">
            <Link href="/member" className="btn-primary">Ke Area Member</Link>
            <Link href="/" className="btn-secondary">Ke Beranda</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-6 sm:py-8">
      <DevNav user={{ name: user.name, role: user.role }} />
      <div className="mt-6">{children}</div>
    </div>
  );
}

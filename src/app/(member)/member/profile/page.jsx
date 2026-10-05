// ============================================================================
// /member/profile, profile and security.
//
// The forms are client components; this page is a server component so the
// session is resolved on the server and only non-sensitive fields are handed to
// the browser. `passwordHash` is never selected (PUBLIC_USER_SELECT), so it
// cannot leak into the RSC payload.
// ============================================================================
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session.js";
import { ProfileForm, PasswordForm, SessionsForm } from "@/components/member/ProfileForms";
import { Alert } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL, USER_STATUS_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profil & Keamanan",
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/member/profile");

  return (
    <div className="container-page py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          Profil &amp; Keamanan
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Kelola data akun dan keamanan sesi Anda.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="card p-5" aria-labelledby="profile-title">
            <h2 id="profile-title" className="mb-4 text-base font-bold text-foreground">
              Data Akun
            </h2>
            <ProfileForm user={user} />
          </section>

          <section className="card p-5" aria-labelledby="password-title">
            <h2 id="password-title" className="mb-4 text-base font-bold text-foreground">
              Ubah Password
            </h2>
            <PasswordForm />
          </section>

          <section className="card p-5" aria-labelledby="sessions-title">
            <h2 id="sessions-title" className="mb-4 text-base font-bold text-foreground">
              Sesi &amp; Perangkat
            </h2>
            <SessionsForm />
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <h2 className="text-base font-bold text-foreground">Status Akun</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <Item label="Status" value={USER_STATUS_LABEL[user.status] ?? user.status} />
              <Item label="Tipe akun" value={ROLE_LABEL[user.role] ?? user.role} />
              <Item label="Terdaftar" value={formatDateTime(user.createdAt)} />
              <Item
                label="Login terakhir"
                value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Belum pernah"}
              />
            </dl>

            {user.status === "BLOCKED" ? (
              <div className="mt-4">
                <Alert tone="danger" title="Akun diblokir">
                  Hubungi dukungan ITOPUP untuk informasi lebih lanjut.
                </Alert>
              </div>
            ) : null}

            <p className="mt-4 text-xs text-foreground-subtle">
              ITOPUP tidak pernah menampilkan atau meminta password Anda. Administrator hanya dapat
              mereset password, tidak pernah melihatnya.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Item({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-foreground-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

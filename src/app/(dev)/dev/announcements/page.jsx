// ============================================================================
// /dev/announcements — control the public announcement banner.
//
// The banner is the topmost element on every public page (see
// AnnouncementBanner in the root layout). This page is the one place it is
// written; everything else only reads it.
//
// WHAT THIS PAGE DOES NOT DO
//
//   It never shows a live preview by rendering the banner twice. The banner
//   above the customer's header and the form on this page are the same
//   component contract, so the operator sees the real thing the moment they
//   save and refresh, not a mock of it.
// ============================================================================
import { readAnnouncement } from "@/services/announcement.service.js";
import { PageHeader, Section, FieldList } from "@/components/dev/DevUI";
import { Badge } from "@/components/ui/primitives";
import AnnouncementForm from "@/components/dev/AnnouncementForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pengumuman" };

export default async function DevAnnouncementsPage() {
  // Raw row for the "currently stored" panel; readAnnouncement() already
  // returns null when disabled, so this covers the disabled-draft case too.
  const announcement = await readAnnouncement();

  return (
    <>
      <PageHeader
        title="Pengumuman"
        description="Pesan ini tampil di bagian paling atas setiap halaman publik, di atas header. Gunakan untuk informasi penting seperti maintenance atau gangguan transaksi."
      />

      <div className="space-y-6">
        <Section
          title="Status saat ini"
          description="Apa yang dilihat customer sekarang."
        >
          {!announcement ? (
            <div className="card p-4">
              <div className="flex items-center gap-2">
                <Badge tone="neutral">Tidak aktif</Badge>
                <span className="text-sm text-foreground-muted">
                  Tidak ada pengumuman yang tampil saat ini.
                </span>
              </div>
            </div>
          ) : (
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={announcement.tone === "error" ? "danger" : announcement.tone === "warning" ? "warning" : "info"}>
                  {announcement.tone === "error" ? "Kritis" : announcement.tone === "warning" ? "Peringatan" : "Info"}
                </Badge>
                {announcement.pauseCheckout ? (
                  <Badge tone="danger">Transaksi dinonaktifkan</Badge>
                ) : null}
                <Badge tone="success">Tampil di publik</Badge>
              </div>
              <FieldList
                items={[
                  { label: "Judul", value: announcement.title },
                  { label: "Keterangan", value: announcement.body ?? "—" },
                ]}
                cols={1}
              />
            </div>
          )}
        </Section>

        <Section
          title="Ubah pengumuman"
          description="Disimpan ke database dan langsung berlaku untuk semua halaman publik tanpa deploy."
        >
          <AnnouncementForm announcement={announcement} />
        </Section>
      </div>
    </>
  );
}

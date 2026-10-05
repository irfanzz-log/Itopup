// ============================================================================
// PromoManager, master/detail for /dev/promos "Kelola promo".
//
// The old section rendered the full edit form for EVERY promo on the page, so
// 20 promos meant 20 identical-looking forms stacked under each other. Here the
// operator picks one from a list and only that one expands.
//
// Default selection is the newest promo, because that is the one an operator
// most likely just created and wants to verify. Passing an explicit `promoId`
// wins over the default, so a "edit" link elsewhere can deep-link in.
//
// This stays a client component on purpose: switching the selection is a local
// UI state change. The server already authorized the actor before rendering
// this page, and every mutation still goes through /api/dev/promos, which
// re-checks the role. The selector here is convenience, not a security control.
// ============================================================================
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/primitives";
import PromoForm from "@/components/dev/PromoForm";
import NativeSelect from "@/components/ui/NativeSelect";

function stateOf(promo) {
  const now = Date.now();
  if (!promo.isActive) return "Nonaktif";
  if (new Date(promo.startsAt).getTime() > now) return "Terjadwal";
  if (new Date(promo.endsAt).getTime() < now) return "Berakhir";
  return "Aktif";
}

export default function PromoManager({ promos = [], initialPromoId = null }) {
  const router = useRouter();

  // items are ordered newest-first by the service, so index 0 IS "the newest".
  const firstId = promos.length > 0 ? promos[0].id : null;
  const [selectedId, setSelectedId] = useState(initialPromoId ?? firstId);

  const selected = promos.find((p) => p.id === selectedId) ?? null;

  if (promos.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">Belum ada promo untuk dikelola.</p>
    );
  }

  // The option label carries the status because the manager list is meant to
  // replace the scan-the-whole-page workflow: title + state in one line.
  const options = promos.map((p) => ({
    value: p.id,
    label: `${p.title} · ${stateOf(p)}${p.codes?.[0]?.code ? ` · ${p.codes[0].code}` : ""}`,
  }));

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <label htmlFor="promomanager-select" className="label">
          Pilih promo
        </label>
        <NativeSelect
          id="promomanager-select"
          options={options}
          value={selectedId}
          onChange={(value) => {
            setSelectedId(value);
            // Drop the deep-link param so the select stays the single source of
            // truth after an explicit pick, otherwise `initialPromoId` would
            // fight the user on the next render.
            if (router) router.replace("/dev/promos", { scroll: false });
          }}
        />
        <p className="hint">
          Default: promo terbaru. Daftar mengikuti filter &amp; pencarian di atas, jadi
          cari dulu kalau promonya tidak ada di opsi.
        </p>
      </div>

      {selected ? (
        <div className="rounded-lg border border-border p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {selected.title}
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-foreground-subtle">
                {selected.slug}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <PromoForm mode="deactivate" promo={selected} />
              <PromoForm mode="delete" promo={selected} />
            </div>
          </div>
          <PromoForm mode="update" promo={selected} />
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">
          Pilih promo dari daftar untuk mulai mengubah.
        </p>
      )}
    </div>
  );
}

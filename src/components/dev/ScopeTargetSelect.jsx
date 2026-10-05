// ============================================================================
// ScopeTargetSelect, the catalog dropdown for a promo's scope.
//
// Asking an operator to type a UUID is unworkable: they do not know the ids, and
// a mistyped id silently produces a promo that never fires. This loads the
// catalog level the scope names (categories / games / products / variants) and
// lets them pick by name, sending the id.
// ============================================================================
"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { Spinner } from "@/components/ui/primitives";
import NativeSelect from "@/components/ui/NativeSelect";

export default function ScopeTargetSelect({ mode, scope, value, onChange, fieldError }) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      // Only the level the scope names is fetched: a variant dropdown of 95
      // rows is pointless when the scope is a category.
      const result = await apiGet(`/api/dev/catalog?level=${scope}`);
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error?.message ?? "Gagal memuat katalog.");
        setOptions([]);
        return;
      }
      setOptions(result.data?.items ?? []);
    }

    if (scope && scope !== "ALL") load();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-foreground-subtle">
        <Spinner /> Memuat katalog…
      </div>
    );
  }

  if (error) {
    return <p className="hint text-danger-fg">{error}</p>;
  }

  return (
    <>
      <NativeSelect
        id={`${mode}-target`}
        name={`${mode}-target`}
        value={value ?? ""}
        onChange={onChange}
        options={options.map((item) => ({ value: item.id, label: item.label }))}
        placeholder={`Pilih ${SCOPE_NOUN[scope] ?? "target"}`}
        invalid={!!fieldError}
      />
      {fieldError ? <p className="hint text-danger-fg">{fieldError}</p> : null}
    </>
  );
}

const SCOPE_NOUN = {
  CATEGORY: "kategori",
  GAME: "game",
  PRODUCT: "layanan",
  VARIANT: "nominal",
};

"use client";

// ============================================================================
// ProductFilters, the /dev/products filter bar.
//
// The category and second-level selects DEPEND on each other: the entry list is
// rebuilt server-side from the chosen category. That re-render only happens on
// a full navigation, so a plain <select> never populates until the operator
// submits the form by hand.
//
// Auto-submitting the category select is the fix: choosing PULSA navigates at
// once, the server returns the OPERATOR list, and the second select is
// populated and enabled before the operator ever touches it.
//
// THE SECOND LEVEL IS CATEGORY-DEPENDENT, which is the whole reason this
// component takes a `secondLevel` object instead of a games array. For GAME
// the meaningful split is the game itself; for PULSA it is the OPERATOR, since
// pulsa is one game whose brands are Telkomsel / XL / Indosat / … . A game
// select there would offer a single useless "Pulsa" option and could never
// narrow the list. The label and the input NAME both follow the category, so
// the value the operator picks reaches `listVariantsForAdmin` as `game` or
// `product` respectively.
// ============================================================================
import { useCallback, useMemo, useRef } from "react";
import NativeSelect from "@/components/ui/NativeSelect";

/**
 * @typedef FilterProps
 * @property {string} search
 * @property {string | null} categoryKind
 * @property {{ kind: string, name: string, id: string }[]} categories
 * @property {{ kind: "game" | "product", label: string, selected: string | null,
 *   entries: { slug: string, name: string, id: string }[] }} secondLevel
 *   Entries already narrowed to the selected category, plus the URL param name
 *   they must be submitted under. Empty while no category is set, so the select
 *   has nothing to offer until one is chosen.
 */

export default function ProductFilters({ search, categoryKind, categories, secondLevel }) {
  // The two selects are controlled by the URL, not by component state: picking a
  // category navigates (server rebuilds the operator list), so the value shown
  // must always come from `categoryKind` / `secondLevel.selected`.
  const formRef = useRef(null);

  const categoryOptions = useMemo(
    () => [{ value: "", label: "Semua kategori" }, ...categories.map((c) => ({ value: c.kind, label: c.name }))],
    [categories]
  );

  // The second-level placeholder and empty state both depend on the category.
  const secondPlaceholder = categoryKind
    ? secondLevel?.entries?.length
      ? `Semua ${(secondLevel.label ?? "").toLowerCase()}`
      : `Tidak ada ${(secondLevel.label ?? "").toLowerCase()}`
    : "Pilih kategori dulu";

  const secondOptions = useMemo(
    () => (secondLevel?.entries ?? []).map((e) => ({ value: e.slug, label: e.name })),
    [secondLevel]
  );

  const onCategoryChange = useCallback((kind) => {
    // Changing category invalidates the second-level choice: the current entry
    // belongs to the previous category and is absent from the new list.
    // Submitting the form with it still selected would query for an entry the UI
    // never offered. We drop it instead of waiting for the server to ignore it,
    // so the URL stays honest.
    const form = formRef.current;
    if (!form) return;
    // Both possible names are cleared: only one is rendered, but a leftover
    // `game` from a GAME visit would survive a switch to PULSA and filter the
    // list to a game the operator cannot see.
    for (const name of ["game", "product"]) {
      const select = form.elements.namedItem(name);
      if (select) select.value = "";
    }
    // Set the real select too, then submit, the form is GET, so this is the
    // navigation that rebuilds the page with the new category applied.
    const categoryEl = form.elements.namedItem("category");
    if (categoryEl) categoryEl.value = kind;
    form.requestSubmit();
  }, []);

  // The second level needs a submit too, but only when it is enabled, an empty
  // category has no entries to pick from, so a tap there is a no-op.
  const onSecondChange = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    form.requestSubmit();
  }, []);

  const disabled = !categoryKind || !secondLevel?.entries?.length;

  return (
    <form
      ref={formRef}
      method="get"
      action="/dev/products"
      className="card mb-4 flex flex-col gap-3 p-4 sm:flex-wrap sm:flex-row sm:items-end"
      // Let Enter in the search field submit as normal; only the category select
      // submits programmatically, and it clears the second-level field first.
    >
      {/* Free-text search must survive a category change, else the operator's
          query is silently dropped the moment they narrow the list. */}
      {search ? <input type="hidden" name="q" value={search} /> : null}

      <div className="min-w-0 flex-1 sm:min-w-[16rem]">
        <label htmlFor="q" className="label">
          Cari varian
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Contoh: 355 Diamonds"
          className="field"
        />
      </div>

      <div className="min-w-0 sm:min-w-[12rem]">
        <label htmlFor="category" className="label">
          Kategori
        </label>
        <NativeSelect
          id="category"
          name="category"
          value={categoryKind ?? ""}
          onChange={onCategoryChange}
          options={categoryOptions}
          placeholder="Semua kategori"
        />
      </div>

      <div className="min-w-0 sm:min-w-[14rem]">
        <label htmlFor="secondLevel" className="label">
          {secondLevel?.label ?? "Game / Layanan"}
        </label>
        <NativeSelect
          id="secondLevel"
          name={secondLevel?.kind ?? "game"}
          value={secondLevel?.selected ?? ""}
          onChange={onSecondChange}
          options={secondOptions}
          disabled={disabled}
          placeholder={secondPlaceholder}
        />
      </div>

      <div className="flex flex-wrap gap-2 sm:contents">
        <button type="submit" className="btn-primary">
          Cari
        </button>
        {search || secondLevel?.selected || categoryKind ? (
          <a href="/dev/products" className="btn-ghost">
            Reset
          </a>
        ) : null}
      </div>
    </form>
  );
}

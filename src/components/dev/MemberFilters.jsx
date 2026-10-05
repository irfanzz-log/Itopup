"use client";

// ============================================================================
// MemberFilters, /dev/members search + status/role filters.
//
// A GET filter form whose selects must submit themselves when changed (the
// operator does not expect to also press "Terapkan" after picking a status).
// Uses NativeSelect so the option list on mobile is anchored to its own button
// instead of to the document, which is where the native popup mis-anchors.
// ============================================================================

import { useCallback, useMemo, useRef } from "react";
import NativeSelect from "@/components/ui/NativeSelect";

/**
 * @typedef MemberFiltersProps
 * @property {string} search
 * @property {string | null} status
 * @property {string | null} role
 * @property {"MEMBER" | "DEV" | "SUPERADMIN"[]} roles
 * @property {"ACTIVE" | "BLOCKED"[]} statuses
 * @property {Record<string, string>} statusLabels
 * @property {Record<string, string>} roleLabels
 */

export default function MemberFilters({ search, status, role, roles, statuses, statusLabels, roleLabels }) {
  const formRef = useRef(null);

  // Selecting a status or role re-runs the query immediately. GET form, so this
  // is a plain navigation.
  const submit = useCallback(() => {
    formRef.current?.requestSubmit();
  }, []);

  const statusOptions = useMemo(
    () => [{ value: "", label: "Semua" }, ...statuses.map((v) => ({ value: v, label: statusLabels[v] ?? v }))],
    [statuses, statusLabels]
  );

  const roleOptions = useMemo(
    () => [{ value: "", label: "Semua" }, ...roles.map((v) => ({ value: v, label: roleLabels[v] ?? v }))],
    [roles, roleLabels]
  );

  return (
    <form
      ref={formRef}
      method="get"
      className="card mb-4 flex flex-col gap-3 p-4 sm:flex-wrap sm:flex-row sm:items-end"
    >
      {status ? <input type="hidden" name="status" value={status} /> : null}
      {role ? <input type="hidden" name="role" value={role} /> : null}
      <div className="min-w-0 flex-1 sm:min-w-[16rem]">
        <label htmlFor="q" className="label">
          Cari
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Nama, email, atau nomor telepon"
          className="field"
        />
      </div>
      <div className="min-w-0 sm:w-40">
        <label htmlFor="status" className="label">
          Status
        </label>
        <NativeSelect
          id="status"
          name="status"
          value={status ?? ""}
          onChange={submit}
          options={statusOptions}
          placeholder="Semua"
        />
      </div>
      <div className="min-w-0 sm:w-40">
        <label htmlFor="role" className="label">
          Peran
        </label>
        <NativeSelect
          id="role"
          name="role"
          value={role ?? ""}
          onChange={submit}
          options={roleOptions}
          placeholder="Semua"
        />
      </div>
      <div className="flex flex-wrap gap-2 sm:contents">
        <button type="submit" className="btn-primary">
          Terapkan
        </button>
        {search || status || role ? (
          <a href="/dev/members" className="btn-ghost">
            Reset
          </a>
        ) : null}
      </div>
    </form>
  );
}

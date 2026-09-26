"use client";

// ============================================================================
// TopupForm — the interactive top-up flow.
//
// This is the ONE client component in the purchase path, and it is deliberately
// dumb about money: it displays prices the server sent and posts a `variantId`.
// It never computes a total that the server trusts, never sees a provider code,
// and never learns a cost price.
//
// Flow: Produk → Data → Pembayaran. The final step happens on /checkout/[invoice]
// after the server has created the order, so a reload cannot lose it.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Spinner } from "@/components/ui/primitives";
import StepIndicator from "@/components/ui/StepIndicator";
import { apiPost } from "@/lib/api-client";
import { deriveIdempotencyKey } from "@/lib/checkout-key";
import { formatIDR, formatNumber } from "@/lib/format";
import { filterMethodsForPurchase } from "@/config/payment";
import { paymentIcon } from "@/config/icons.js";

/** Draft persisted across a login redirect so the customer does not lose input. */
const draftKey = (slug) => `itp:topup-draft:${slug}`;

export default function TopupForm({ game, products, paymentMethods }) {
  const router = useRouter();

  const [productId, setProductId] = useState(products[0]?.id ?? null);
  const [variantId, setVariantId] = useState(null);
  const [fields, setFields] = useState(() => blankFields(game.inputFields));
  const [promoCode, setPromoCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]?.key ?? null);

  const [validation, setValidation] = useState({ state: "idle", data: null, error: null });
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? products[0] ?? null,
    [products, productId]
  );
  const variant = useMemo(
    () => product?.variants.find((v) => v.id === variantId) ?? null,
    [product, variantId]
  );

  // ── Which methods this purchase may actually use ──────────────────────────
  //
  // Enforced server-side too (see filterMethodsForPurchase): a method is
  // hidden below its minimum. This is what removes bank transfers on a
  // Rp 1.600 diamond purchase instead of letting the customer pick one and be
  // refused at the end.
  //
  // NOT done here: filtering e-wallet methods by the game being topped up. A
  // payment method is an instrument — paying diamonds from DANA is normal,
  // and the old `walletSlug` filter hid every other wallet at checkout.
  const offeredMethods = useMemo(
    () =>
      filterMethodsForPurchase(paymentMethods, {
        amount: variant?.sellingPrice ?? null,
      }),
    [paymentMethods, variant?.sellingPrice]
  );

  // A selection that is no longer offered must not survive: the customer would
  // see nothing selected while `paymentMethod` still held the hidden key, and
  // the order would be created with a method the UI no longer showed.
  useEffect(() => {
    if (offeredMethods.length === 0) return;
    if (!offeredMethods.some((m) => m.key === paymentMethod)) {
      setPaymentMethod(offeredMethods[0].key);
    }
  }, [offeredMethods, paymentMethod]);

  // Methods that exist but are hidden for THIS purchase because the amount is
  // below their floor. Computed from the full list on purpose: `minOffered`
  // above is the minimum among the methods that SURVIVED the filter, so it can
  // never be greater than the amount — using it to explain the removal would
  // produce a message that never renders.
  const hiddenByAmount = useMemo(() => {
    const amount = Number(variant?.sellingPrice ?? 0);
    if (!amount) return [];
    return paymentMethods.filter((m) => amount < Number(m.minAmount ?? 0));
  }, [paymentMethods, variant?.sellingPrice]);

  // ── Restore a draft saved before a login redirect ────────────────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey(game.slug));
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft?.variantId) setVariantId(draft.variantId);
      if (draft?.productId) setProductId(draft.productId);
      if (draft?.fields) setFields((prev) => ({ ...prev, ...draft.fields }));
      if (draft?.promoCode) setPromoCode(draft.promoCode);
      if (draft?.paymentMethod) setPaymentMethod(draft.paymentMethod);
    } catch {
      // A corrupt draft is not worth surfacing — start clean.
    }
  }, [game.slug]);

  const saveDraft = useCallback(() => {
    try {
      sessionStorage.setItem(
        draftKey(game.slug),
        JSON.stringify({ productId, variantId, fields, promoCode, paymentMethod })
      );
    } catch {
      // Private mode / quota: the flow still works, it just will not resume.
    }
  }, [game.slug, productId, variantId, fields, promoCode, paymentMethod]);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(draftKey(game.slug));
    } catch {
      /* ignore */
    }
  }, [game.slug]);

  // The account is verified as part of "Lanjut ke Pembayaran", so this form never
  // sits on a "pembayaran" step — creating the order navigates to the order page.
  const step = !variant ? "produk" : "data";

  // ── Input handling ───────────────────────────────────────────────────────
  function updateField(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    // Any change invalidates a previous validation result: the account that was
    // just verified is no longer the account in the form.
    setValidation({ state: "idle", data: null, error: null });
  }

  function selectVariant(id) {
    setVariantId((current) => (current === id ? null : id));
    setValidation({ state: "idle", data: null, error: null });
  }

  // ── Account validation ───────────────────────────────────────────────────
  /**
   * Ask the server whether the account exists.
   *
   * Called from `handleCheckout` — NOT from a button of its own. The answer is
   * only useful at the moment the customer commits, and a separate "Cek Akun"
   * button let them check, change the nominal, and then reach checkout with a
   * stale verification. The result is returned rather than only written to
   * state, because the caller must decide whether to continue.
   *
   * @returns {Promise<{ok: true, data: object} | {ok: false, error: object, fieldErrors?: object}>}
   */
  async function verifyAccount() {
    setValidation({ state: "loading", data: null, error: null });

    const result = await apiPost("/api/topup/validate", {
      gameSlug: game.slug,
      fields: trimValues(fields),
    });

    if (!result.ok) {
      // An outage is NOT "account not found". Telling a customer to fix a
      // correct player id because the provider was unreachable is how they
      // retype a working id forever — so the provider's own message is shown.
      setValidation({ state: "error", data: null, error: result.error });
      return { ok: false, error: result.error };
    }

    // The server answers 200 with `valid: false` when the provider says no such
    // account. That is the case the customer has to fix, and it is the case
    // that must NOT reach the payment step.
    if (!result.data?.valid) {
      const error = {
        code: "ITP_INVALID_ACCOUNT",
        message: accountNotFoundMessage(game.inputFields),
      };
      setValidation({ state: "error", data: null, error });
      return { ok: false, error, fieldErrors: allFieldErrors(game.inputFields) };
    }

    setValidation({ state: "ok", data: result.data, error: null });
    return { ok: true, data: result.data };
  }

  // ── Checkout ─────────────────────────────────────────────────────────────
  /**
   * "Lanjut ke Pembayaran" — validate, verify the account, then create the order.
   *
   * ORDER OF OPERATIONS IS THE POINT:
   *   1. local field check (instant, no network),
   *   2. server-side account verification — the account details are shown HERE,
   *      and an account that does not exist stops the flow with the id/zone
   *      fields flagged,
   *   3. only then is the order created.
   *
   * The account is verified on every attempt, including a retry after a change,
   * so the account the customer pays for is always the account that was checked.
   */
  async function handleCheckout() {
    if (submitting || checking) return;

    // ── 1. Local field check ───────────────────────────────────────────────
    const localErrors = validateLocally(game.inputFields, fields);
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setFormError({
        code: "ITP_INVALID_INPUT",
        message: "Periksa kembali data akun yang Anda masukkan.",
      });
      return;
    }

    setFieldErrors({});
    setFormError(null);

    // ── 2. Server-side account verification ────────────────────────────────
    // Only for games whose provider exposes the check. A game without it cannot
    // be verified, and refusing the purchase outright would break it.
    if (canValidate) {
      setChecking(true);
      const verified = await verifyAccount();
      setChecking(false);

      if (!verified.ok) {
        // Stop here. The customer fixes User ID / Zone ID and presses the same
        // button again — they never reach a payment step for an account that
        // does not exist.
        setFieldErrors(verified.fieldErrors ?? {});
        setFormError(verified.error);
        return;
      }
    }

    // ── 3. Create the order ────────────────────────────────────────────────
    setSubmitting(true);

    // The key is DERIVED FROM THE PAYLOAD, not from a per-variant random seed.
    //
    // The bug this replaces: the seed was stored per (game, variant), so a
    // customer who picked a nominal, checked the account, chose a payment
    // method, then changed the nominal back and forth could submit the same key
    // with a different `paymentMethod`/`fields` payload. The server compares the
    // payload hash against the stored order and answers ITP_IDEMPOTENCY_CONFLICT
    // ("Permintaan tidak cocok dengan transaksi sebelumnya") — a dead end on a
    // purchase the customer was entitled to make.
    //
    // With a payload-derived key, the same payload is always the same key (so a
    // double click still returns the existing order), and ANY change produces a
    // different key (so a changed purchase is a new order, never a conflict).
    const idempotencyKey = await newIdempotencyKey({
      slug: game.slug,
      variantId,
      fields: trimValues(fields),
      promoCode: promoCode.trim(),
      paymentMethod,
    });
    saveDraft();

    const result = await apiPost("/api/orders", {
      variantId,
      fields: trimValues(fields),
      promoCode: promoCode.trim() || undefined,
      paymentMethod,
      idempotencyKey,
    });

    if (result.ok) {
      clearDraft();
      router.push(`/member/orders/${result.data.order.id}`);
      return;
    }

    setSubmitting(false);

    // Not signed in: the draft is already saved, so send them to login and come
    // straight back to this page with the selection intact.
    if (result.status === 401) {
      const back = `/topup/${categorySegment(game)}/${game.slug}`;
      router.push(`/login?next=${encodeURIComponent(back)}`);
      return;
    }

    setFormError(result.error);
    if (Array.isArray(result.error?.details)) {
      setFieldErrors(
        Object.fromEntries(result.error.details.map((d) => [d.field, d.message]))
      );
    }
  }

  const disabled = !variant || !paymentMethod || submitting || checking;
  const canValidate = game.supportsValidation && game.inputFields.length > 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <StepIndicator current={step} hrefs={{ produk: `/topup/${categorySegment(game)}/${game.slug}` }} />

        {/* ── Step 1: product type + nominal ─────────────────────────────── */}
        <section className="card p-5">
          <h2 className="text-base font-bold text-foreground">1. Pilih nominal</h2>

          {products.length > 1 ? (
            <div role="tablist" aria-label="Jenis produk" className="mt-3 flex flex-wrap gap-2">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={p.id === productId}
                  onClick={() => {
                    setProductId(p.id);
                    setVariantId(null);
                    setValidation({ state: "idle", data: null, error: null });
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    p.id === productId
                      ? "border-brand-500 bg-brand-soft text-brand-700 dark:text-brand-100"
                      : "border-border text-foreground-muted hover:border-brand-300 hover:text-foreground"
                  }`}
                >
                  {p.icon ? (
                    <img
                      src={p.icon}
                      alt=""
                      className="h-7 w-16 rounded object-contain bg-white/70 px-1 dark:bg-white/10"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                  {p.name}
                </button>
              ))}
            </div>
          ) : null}

          {product?.variants.length ? (
            <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {product.variants.map((v) => {
                const selected = v.id === variantId;
                const outOfStock = v.stock !== null && v.stock <= 0;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      disabled={outOfStock}
                      aria-pressed={selected}
                      onClick={() => selectVariant(v.id)}
                      className={`relative flex h-full w-full flex-col items-start gap-1 rounded-[var(--radius-control)] border p-3 text-left transition-colors ${
                        selected
                          ? "border-brand-500 bg-brand-soft ring-1 ring-brand-500"
                          : outOfStock
                            ? "cursor-not-allowed border-border bg-surface-muted opacity-60"
                            : "border-border bg-surface hover:border-brand-400"
                      }`}
                    >
                      {selected ? (
                        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
                          </svg>
                        </span>
                      ) : null}
                      <span className="pr-6 text-sm font-semibold leading-snug text-foreground">
                        {v.name}
                      </span>
                      <span className="text-sm font-bold text-brand-700 dark:text-brand-300">
                        {formatIDR(v.sellingPrice)}
                      </span>
                      {outOfStock ? (
                        <span className="text-xs font-medium text-foreground-subtle">Stok habis</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-foreground-muted">Produk sedang tidak tersedia.</p>
          )}
        </section>

        {/* ── Step 2: account data ──────────────────────────────────────── */}
        <section className="card p-5">
          <h2 className="text-base font-bold text-foreground">2. Masukkan data akun</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Pastikan data benar. Kesalahan input di luar tanggung jawab ITOPUP.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {game.inputFields.map((def) => (
              <div key={def.key} className={def.wide ? "sm:col-span-2" : ""}>
                <label htmlFor={`f-${def.key}`} className="label">
                  {def.label}
                  {def.required !== false ? <span className="text-danger-fg"> *</span> : null}
                </label>
                <input
                  id={`f-${def.key}`}
                  name={def.key}
                  type={def.inputType || "text"}
                  inputMode={def.inputMode || "text"}
                  autoComplete={def.autoComplete || "off"}
                  placeholder={def.placeholder || ""}
                  maxLength={def.maxLength || 64}
                  value={fields[def.key] ?? ""}
                  onChange={(e) => updateField(def.key, e.target.value)}
                  aria-invalid={fieldErrors[def.key] ? "true" : undefined}
                  aria-describedby={
                    fieldErrors[def.key] ? `e-${def.key}` : def.helpText ? `h-${def.key}` : undefined
                  }
                  className={`field ${fieldErrors[def.key] ? "field-error" : ""}`}
                  required={def.required !== false}
                />
                {def.helpText && !fieldErrors[def.key] ? (
                  <p id={`h-${def.key}`} className="hint">
                    {def.helpText}
                  </p>
                ) : null}
                {fieldErrors[def.key] ? (
                  <p id={`e-${def.key}`} className="mt-1 text-xs font-medium text-danger-fg">
                    {fieldErrors[def.key]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {canValidate ? (
            <p className="mt-4 text-xs text-foreground-subtle">
              Data akun dicek otomatis ke penyedia saat Anda menekan “Lanjut ke Pembayaran”.
              Nama akun akan ditampilkan di halaman pembayaran sebagai konfirmasi.
            </p>
          ) : (
            <p className="mt-4 text-xs text-foreground-subtle">
              Pengecekan akun otomatis belum tersedia untuk layanan ini. Pastikan data sudah benar
              sebelum melanjutkan.
            </p>
          )}

          {/* A failed check stays on this page — that is the whole point. The
              SUCCESS case never renders here: it navigates straight to the order
              page, where the verified account name is shown next to the amount. */}
          {validation.state === "error" ? (
            <div className="mt-4">
              <Alert tone="warning" title="Akun tidak dapat diverifikasi">
                <p>{validation.error?.message || "Periksa kembali data yang Anda masukkan."}</p>
              </Alert>
            </div>
          ) : null}
        </section>

        {/* ── Step 3: payment method ────────────────────────────────────── */}
        <section className="card p-5">
          <h2 className="text-base font-bold text-foreground">3. Pilih pembayaran</h2>

          {offeredMethods.length === 0 ? (
            <div className="mt-4">
              <Alert tone="info" title="Metode pembayaran belum tersedia">
                <p>
                  Belum ada metode pembayaran yang bisa dipakai untuk nominal ini. Pilih nominal
                  lain, atau hubungi dukungan untuk dibantu manual.
                </p>
              </Alert>
            </div>
          ) : (
            <fieldset className="mt-4 space-y-5">
              <legend className="sr-only">Metode pembayaran</legend>
              {hiddenByAmount.length > 0 ? (
                <p className="text-xs text-foreground-subtle">
                  Untuk nominal ini, transfer bank belum bisa dipakai (minimum Rp{" "}
                  {formatNumber(hiddenByAmount[0].minAmount ?? 0)}). Pilihan di
                  bawah adalah metode yang bisa menyelesaikan pembayaran sekarang.
                </p>
              ) : null}
              {groupMethods(offeredMethods).map(({ group, items }) => (
                <div key={group}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                    {group}
                  </p>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {items.map((method) => {
                      const icon = paymentIcon(method.key);
                      return (
                      <label
                        key={method.key}
                        className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 transition-colors ${
                          method.key === paymentMethod
                            ? "border-brand-500 bg-brand-soft"
                            : "border-border hover:border-brand-400"
                        }`}
                      >
                        <input
                          type="radio"
                          name="paymentMethod"
                          value={method.key}
                          checked={method.key === paymentMethod}
                          onChange={() => setPaymentMethod(method.key)}
                          className="mt-1 h-4 w-4 accent-brand-600"
                        />
                        {icon ? (
                          <img
                            src={icon}
                            alt=""
                            className="mt-0.5 h-7 w-16 shrink-0 rounded object-contain bg-white/70 px-1 dark:bg-white/10"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : null}
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{method.label}</span>
                          </span>
                          <span className="mt-0.5 block text-xs text-foreground-muted">
                            {method.description || feeLabel(method)}
                          </span>
                        </span>
                      </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </fieldset>
          )}
        </section>
      </div>

      {/* ── Summary rail ──────────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="card p-5">
          <h2 className="text-base font-bold text-foreground">Ringkasan</h2>

          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Layanan" value={game.name} />
            <Row label="Produk" value={product?.name ?? "—"} />
            <Row label="Nominal" value={variant?.name ?? "Belum dipilih"} />
            {game.inputFields.map((def) =>
              fields[def.key] ? (
                <Row key={def.key} label={def.label} value={fields[def.key]} />
              ) : null
            )}
          </dl>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-foreground-muted">Harga</span>
              <span className="text-lg font-extrabold text-foreground">
                {variant ? formatIDR(variant.sellingPrice) : "—"}
              </span>
            </div>
            <p className="mt-1 text-xs text-foreground-subtle">
              Biaya admin dan total akhir dihitung di halaman pembayaran.
            </p>
          </div>

          <div className="mt-4">
            <label htmlFor="promo" className="label">Kode promo (opsional)</label>
            <input
              id="promo"
              name="promoCode"
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="Contoh: ITOPUP10"
              maxLength={40}
              autoComplete="off"
              className="field uppercase placeholder:normal-case"
            />
          </div>

          {formError ? (
            <div className="mt-4">
              <Alert tone="danger">{formError.message || "Terjadi kesalahan. Silakan coba lagi."}</Alert>
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleCheckout}
            disabled={disabled}
            className="btn-primary mt-4 w-full"
          >
            {submitting || checking ? <Spinner /> : null}
            {checking ? "Memeriksa akun…" : submitting ? "Memproses…" : "Lanjut ke Pembayaran"}
          </button>

          {!variant ? (
            <p className="mt-2 text-center text-xs text-foreground-subtle">
              Pilih nominal terlebih dahulu.
            </p>
          ) : canValidate ? (
            <p className="mt-2 text-center text-xs text-foreground-subtle">
              Data akun akan dicek otomatis saat Anda menekan tombol ini.
            </p>
          ) : null}

          <p className="mt-3 text-center text-xs text-foreground-subtle">
            Dengan melanjutkan Anda menyetujui{" "}
            <a href="/syarat" className="underline hover:text-foreground">Syarat &amp; Ketentuan</a>{" "}
            ITOPUP.
          </p>
        </div>
      </aside>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-foreground-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function blankFields(defs) {
  return Object.fromEntries((defs ?? []).map((def) => [def.key, ""]));
}

function trimValues(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value ?? "").trim()])
  );
}

/**
 * Message shown when the provider says the account does not exist.
 *
 * It NAMES the fields the customer must fix (User ID / Zone ID) instead of
 * saying "data tidak valid", because the customer's next action is to correct
 * exactly those two fields. Labels come from the game's own field contract, so a
 * game with a different pair of fields gets the right wording without a code
 * change.
 */
function accountNotFoundMessage(defs) {
  const labels = (defs ?? []).map((def) => def.label).filter(Boolean);
  if (labels.length === 0) {
    return "Akun tidak ditemukan. Periksa kembali data yang Anda masukkan.";
  }
  return `Akun tidak ditemukan. Periksa kembali ${labels.join(" dan ")} Anda, lalu coba lagi.`;
}

/** Flag every account field, so the correction is impossible to miss. */
function allFieldErrors(defs) {
  const message = "Periksa kembali data ini.";
  return Object.fromEntries((defs ?? []).map((def) => [def.key, message]));
}

/**
 * Client-side pre-check. It mirrors `validateFields` in src/config/input-fields.js
 * but is NOT a security control — the same rules run again on the server, which
 * is the only authority. This exists purely to give instant feedback.
 */
function validateLocally(defs, values) {
  const errors = {};
  for (const def of defs ?? []) {
    const value = String(values?.[def.key] ?? "").trim();
    if (!value) {
      if (def.required !== false) errors[def.key] = `${def.label} wajib diisi.`;
      continue;
    }
    if (def.minLength && value.length < def.minLength) {
      errors[def.key] = def.errorMessage || `${def.label} minimal ${def.minLength} karakter.`;
      continue;
    }
    if (def.maxLength && value.length > def.maxLength) {
      errors[def.key] = def.errorMessage || `${def.label} maksimal ${def.maxLength} karakter.`;
      continue;
    }
    if (def.pattern && !new RegExp(def.pattern).test(value)) {
      errors[def.key] = def.errorMessage || `${def.label} tidak valid.`;
    }
  }
  return errors;
}

/**
 * One idempotency key per PAYLOAD, not per variant.
 *
 * A random per-variant seed was the cause of the "Permintaan tidak cocok dengan
 * transaksi sebelumnya" dead end: the seed outlived the payload it was created
 * for, so changing the nominal or the payment method and submitting again
 * reused the key with a different body. See src/lib/checkout-key.js for the full
 * explanation — the derivation lives there so it can be unit-tested.
 */
function newIdempotencyKey(payload) {
  return deriveIdempotencyKey(payload);
}

function feeLabel(method) {
  if (!method.feeFlat && !method.feePercent) return "Tanpa biaya tambahan";
  const parts = [];
  if (method.feePercent) parts.push(`${formatNumber(method.feePercent)}%`);
  if (method.feeFlat) parts.push(formatIDR(method.feeFlat));
  return `Biaya ${parts.join(" + ")}`;
}

/**
 * Group methods by their `group` label for rendering, preserving the order the
 * server sent them in.
 *
 * Fifteen flat options is a wall of radio buttons; grouped, the customer reads
 * "Transfer Bank", then "E-Wallet", and only scans the group they have. The
 * order is preserved rather than sorted, because the server's order puts the
 * methods that work today first.
 */
function groupMethods(methods) {
  const groups = new Map();
  for (const method of methods) {
    const key = method.group || "Lainnya";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(method);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

function categorySegment(game) {
  if (game.categoryKind === "PULSA") return "pulsa";
  return "game";
}

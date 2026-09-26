// ============================================================================
// /dev/products — catalogue and pricing.
//
// THE PRICE COLUMN IS THE POINT. Every variant shows:
//   costPrice      — what the provider charges us (from the last sync),
//   sellingPrice   — what the customer pays (server-owned),
//   margin         — the difference, and the percent,
//   suggestedPrice — what the pricing rules WOULD derive from the cost.
//
// When sellingPrice differs from suggestedPrice the row is marked, because that
// is either a deliberate business decision or a stale price — and the operator
// is the only one who can tell which.
// ============================================================================
import Link from "next/link";
import { listVariantsForAdmin, catalogSummary } from "@/services/catalog.service.js";
import { PageHeader, Section, StatCard, StatGrid, DataTable, Td, Money } from "@/components/dev/DevUI";
import { Badge, EmptyState } from "@/components/ui/primitives";
import Pagination, { ResultCount } from "@/components/ui/Pagination";
import { formatIDR } from "@/lib/format";
import { CATEGORY_KIND_LABEL } from "@/lib/constants";
import ProductActions from "@/components/dev/ProductActions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Produk & Harga" };

export default async function DevProductsPage({ searchParams }) {
  const params = await searchParams;

  const page = Math.max(1, parseInt(params?.page ?? "1", 10) || 1);
  const search = typeof params?.q === "string" ? params.q.slice(0, 100) : "";
  const gameSlug = typeof params?.game === "string" ? params.game.slice(0, 100) : null;

  const [{ items, pagination }, summary] = await Promise.all([
    listVariantsForAdmin({ page, limit: 30, search, gameSlug }),
    catalogSummary(),
  ]);

  const buildHref = (nextPage) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (gameSlug) query.set("game", gameSlug);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return `/dev/products${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Produk & Harga"
        description="Harga jual ditentukan server. Harga pokok berasal dari sinkronisasi provider dan tidak pernah ditampilkan ke pelanggan."
      />

      <div className="mb-6">
        <StatGrid cols={5}>
          <StatCard label="Kategori" value={summary.categories} />
          <StatCard label="Game / Layanan" value={summary.games} />
          <StatCard label="Produk" value={summary.products} />
          <StatCard label="Varian aktif" value={summary.activeVariants} hint={`${summary.variants} total`} />
          <StatCard
            label="Tidak dapat dijual"
            value={summary.unsellableVariants}
            hint="Aktif tanpa mapping provider"
            tone={summary.unsellableVariants > 0 ? "danger" : "success"}
          />
        </StatGrid>
      </div>

      {summary.unsellableVariants > 0 ? (
        <div className="mb-6">
          <Badge tone="danger">
            {summary.unsellableVariants} varian aktif tidak punya mapping provider — tidak akan
            pernah bisa dijual sampai di-link lewat sinkronisasi.
          </Badge>
        </div>
      ) : null}

      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        {gameSlug ? <input type="hidden" name="game" value={gameSlug} /> : null}
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="q" className="label">Cari varian</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Contoh: 355 Diamonds"
            className="field"
          />
        </div>
        <button type="submit" className="btn-primary">Cari</button>
        {search || gameSlug ? <Link href="/dev/products" className="btn-ghost">Reset</Link> : null}
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon="box"
          title="Tidak ada varian"
          description={
            search || gameSlug
              ? "Tidak ada varian yang cocok dengan filter ini."
              : "Jalankan sinkronisasi katalog dari provider di /dev/providers untuk mengisi produk."
          }
          action={<Link href="/dev/providers" className="btn-primary">Ke Provider</Link>}
        />
      ) : (
        <Section
          title="Varian produk"
          description={`Menampilkan ${items.length} dari ${pagination.total} varian.`}
        >
          <ResultCount page={pagination.page} limit={pagination.limit} total={pagination.total} noun="varian" />

          <div className="mt-3">
            <DataTable
              caption="Daftar varian produk beserta harga dan stok provider"
              columns={[
                { key: "varian", label: "Varian" },
                { key: "layanan", label: "Layanan" },
                { key: "hpp", label: "Harga pokok", align: "right" },
                { key: "jual", label: "Harga jual", align: "right" },
                { key: "margin", label: "Margin", align: "right" },
                { key: "status", label: "Status" },
                { key: "sku", label: "SKU provider" },
                { key: "aksi", label: "Aksi" },
              ]}
              rows={items}
              renderRow={(variant) => {
                // A price that differs from the derived one is either a decision
                // or drift. Either way it must be visible.
                const pinned = variant.sellingPrice !== variant.suggestedPrice;
                const mapping = variant.providerProducts?.[0] ?? null;
                // The provider's own availability flag is the stock signal: the
                // pricelist carries no quantity, only active | out_of_stock.
                const skuAvailable = mapping?.isAvailable ?? null;

                return (
                  <>
                    <Td>
                      <span className="block text-xs font-medium text-foreground">{variant.name}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-foreground-subtle">
                        {variant.slug}
                      </span>
                    </Td>
                    <Td>
                      <span className="block text-xs text-foreground-muted">
                        {variant.product?.game?.name ?? "—"}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                        {CATEGORY_KIND_LABEL[variant.product?.game?.category?.kind] ?? ""}
                        {variant.denomination ? ` · ${variant.denomination} ${variant.unit ?? ""}` : ""}
                      </span>
                    </Td>
                    <Td align="right">
                      <Money value={variant.costPrice} className="text-xs text-foreground-muted" />
                    </Td>
                    <Td align="right">
                      <Money value={variant.sellingPrice} className="text-xs font-semibold text-foreground" />
                      {pinned ? (
                        <span className="mt-0.5 block text-[11px] text-warning-fg" title="Berbeda dari harga hasil hitung otomatis">
                          diset manual · saran {formatIDR(variant.suggestedPrice)}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      <Money value={variant.margin} className="text-xs" />
                      <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                        {variant.marginPercent.toFixed(1)}%
                      </span>
                    </Td>
                    <Td>
                      {variant.isActive ? (
                        <Badge tone="success">Aktif</Badge>
                      ) : (
                        <Badge tone="neutral">Nonaktif</Badge>
                      )}
                      {variant.stock !== null && variant.stock !== undefined ? (
                        <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                          stok {variant.stock}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      {mapping ? (
                        <>
                          <span className="block font-mono text-[11px] text-foreground">{mapping.providerCode}</span>
                          {skuAvailable === false ? (
                            <span className="mt-0.5 block">
                              <Badge tone="danger">out of stock</Badge>
                            </span>
                          ) : skuAvailable === true ? (
                            <span className="mt-0.5 block">
                              <Badge tone="success">active</Badge>
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <Badge tone="warning">belum di-link</Badge>
                      )}
                    </Td>
                    <Td>
                      <ProductActions
                        variantId={variant.id}
                        variantName={variant.name}
                        sellingPrice={variant.sellingPrice}
                        costPrice={variant.costPrice}
                        isActive={variant.isActive}
                        linkedSku={mapping?.providerCode ?? null}
                        linkedAvailable={skuAvailable}
                        hasOrders={Boolean(variant._count?.orderItems)}
                      />
                    </Td>
                  </>
                );
              }}
              renderCard={(variant) => {
                const mapping = variant.providerProducts?.[0] ?? null;
                const skuAvailable = mapping?.isAvailable ?? null;
                return (
                  <div className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{variant.name}</p>
                        <p className="mt-0.5 truncate text-xs text-foreground-subtle">
                          {variant.product?.game?.name ?? "—"}
                        </p>
                        {mapping ? (
                          <p className="mt-0.5 font-mono text-[11px] text-foreground-subtle">
                            {mapping.providerCode}
                            {skuAvailable === false ? " · out of stock" : ""}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[11px] text-warning-fg">belum di-link</p>
                        )}
                      </div>
                      {variant.isActive ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>}
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-foreground-subtle">HPP</dt>
                        <dd className="font-semibold tabular-nums text-foreground-muted">
                          <Money value={variant.costPrice} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-foreground-subtle">Jual</dt>
                        <dd className="font-semibold tabular-nums text-foreground">
                          <Money value={variant.sellingPrice} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-foreground-subtle">Margin</dt>
                        <dd className="font-semibold tabular-nums text-foreground">
                          <Money value={variant.margin} />
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 border-t border-border pt-3">
                      <ProductActions
                        variantId={variant.id}
                        variantName={variant.name}
                        sellingPrice={variant.sellingPrice}
                        costPrice={variant.costPrice}
                        isActive={variant.isActive}
                        linkedSku={mapping?.providerCode ?? null}
                        linkedAvailable={skuAvailable}
                        hasOrders={Boolean(variant._count?.orderItems)}
                      />
                    </div>
                  </div>
                );
              }}
            />
          </div>

          <Pagination className="mt-5" page={pagination.page} pages={pagination.pages} buildHref={buildHref} />
        </Section>
      )}
    </>
  );
}

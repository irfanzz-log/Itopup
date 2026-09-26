-- =============================================================================
-- ITOPUP — Supabase bootstrap (SCHEMA ONLY)
--
-- Jalankan di Supabase Dashboard -> SQL Editor -> Run, pada database kosong.
-- Cocok untuk production: TIDAK ada data contoh / kredensial di file ini.
--
-- Isi file ini dihasilkan dari dump skema database yang sudah dimigrasi
-- (pg_dump --schema-only), jadi byte-per-byte identik dengan hasil
-- `prisma migrate deploy` di project ini. Tidak ada DDL yang diketik ulang.
--
-- Setelah ini jalan, `npx prisma migrate deploy` akan melaporkan
-- "No pending migrations to apply" — bukan error, bukan drift.
--
-- CATATAN DESAIN (jangan diubah tanpa alasan):
--   * Kolom "id" adalah TEXT tanpa DEFAULT. Prisma meng-generate UUID di sisi
--     client. Menambah DEFAULT gen_random_uuid() akan terbaca sebagai schema
--     drift oleh `prisma migrate diff`.
--   * Semua uang disimpan INTEGER rupiah, tidak ada FLOAT/NUMERIC.
--   * Bagian RLS di bawah mengunci tabel dari PostgREST (anon/authenticated).
--     App ini pakai auth sendiri (tabel sessions + bcrypt), bukan Supabase Auth.
--     Prisma connect sebagai role postgres (pemilik tabel) sehingga RLS
--     dilewati dan aplikasi tetap jalan normal.
-- =============================================================================

CREATE TYPE public."CategoryKind" AS ENUM (
    'GAME',
    'E_WALLET',
    'PULSA'
);

CREATE TYPE public."DiscountType" AS ENUM (
    'FIXED',
    'PERCENT'
);

CREATE TYPE public."OrderStatus" AS ENUM (
    'PENDING_PAYMENT',
    'PAYMENT_PROCESSING',
    'PAID',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'REFUND',
    'EXPIRED',
    'CANCELLED'
);

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'PAID',
    'FAILED',
    'EXPIRED',
    'REFUNDED',
    'CANCELLED'
);

CREATE TYPE public."ProviderKind" AS ENUM (
    'TOPUP',
    'PAYMENT'
);

CREATE TYPE public."ProviderStatus" AS ENUM (
    'ACTIVE',
    'DEGRADED',
    'DISABLED'
);

CREATE TYPE public."Role" AS ENUM (
    'MEMBER',
    'DEV',
    'SUPERADMIN'
);

CREATE TYPE public."SortMode" AS ENUM (
    'NOMINAL',
    'MANUAL'
);

CREATE TYPE public."UserStatus" AS ENUM (
    'ACTIVE',
    'BLOCKED'
);

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public."_ProductVariantToPromo" (
    "A" text NOT NULL,
    "B" text NOT NULL
);

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    "actorId" text,
    "actorRole" public."Role",
    action text NOT NULL,
    "targetType" text,
    "targetId" text,
    metadata jsonb,
    ip text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.categories (
    id text NOT NULL,
    kind public."CategoryKind" NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.games (
    id text NOT NULL,
    "categoryId" text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    publisher text,
    description text,
    logo text,
    banner text,
    "inputFields" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "supportsValidation" boolean DEFAULT false NOT NULL,
    "isPopular" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.order_items (
    id text NOT NULL,
    "orderId" text NOT NULL,
    "productVariantId" text NOT NULL,
    "gameName" text NOT NULL,
    "productName" text NOT NULL,
    "variantName" text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    "unitCostPrice" integer NOT NULL,
    "unitSellingPrice" integer NOT NULL,
    subtotal integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.orders (
    id text NOT NULL,
    invoice text NOT NULL,
    "userId" text NOT NULL,
    status public."OrderStatus" DEFAULT 'PENDING_PAYMENT'::public."OrderStatus" NOT NULL,
    "gameName" text NOT NULL,
    "productName" text NOT NULL,
    "variantName" text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    "customerInput" jsonb NOT NULL,
    "unitCostPrice" integer NOT NULL,
    "unitSellingPrice" integer NOT NULL,
    subtotal integer NOT NULL,
    discount integer DEFAULT 0 NOT NULL,
    fee integer DEFAULT 0 NOT NULL,
    total integer NOT NULL,
    margin integer DEFAULT 0 NOT NULL,
    "providerId" text,
    "providerRef" text,
    "providerOrderId" text,
    "providerStatus" text,
    "providerMessage" text,
    "providerAttempts" integer DEFAULT 0 NOT NULL,
    "dispatchedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "idempotencyKey" text NOT NULL,
    "requestHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    ip text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.payments (
    id text NOT NULL,
    "orderId" text NOT NULL,
    "providerCode" text NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    method text,
    reference text,
    "externalId" text,
    amount integer NOT NULL,
    fee integer DEFAULT 0 NOT NULL,
    "paidAmount" integer,
    instructions jsonb,
    "expiresAt" timestamp(3) without time zone,
    "paidAt" timestamp(3) without time zone,
    "rawPayload" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.product_variants (
    id text NOT NULL,
    "productId" text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    denomination integer,
    unit text,
    "costPrice" integer NOT NULL,
    "sellingPrice" integer NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    stock integer,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.products (
    id text NOT NULL,
    "gameId" text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text,
    "sortMode" public."SortMode" DEFAULT 'NOMINAL'::public."SortMode" NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.promo_codes (
    id text NOT NULL,
    "promoId" text NOT NULL,
    code text NOT NULL,
    "usageLimit" integer,
    "usageCount" integer DEFAULT 0 NOT NULL,
    "perUserLimit" integer,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.promos (
    id text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    description text,
    image text,
    banner text,
    "discountType" public."DiscountType" NOT NULL,
    "discountValue" integer NOT NULL,
    "maxDiscount" integer,
    "minSpend" integer DEFAULT 0 NOT NULL,
    "startsAt" timestamp(3) without time zone NOT NULL,
    "endsAt" timestamp(3) without time zone NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdById" text
);

CREATE TABLE public.provider_products (
    id text NOT NULL,
    "providerId" text NOT NULL,
    "productVariantId" text NOT NULL,
    "providerCode" text NOT NULL,
    "providerName" text,
    "providerPrice" integer,
    "providerStock" integer,
    "isAvailable" boolean DEFAULT true NOT NULL,
    "lastSyncPayload" jsonb,
    "lastSyncAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.providers (
    id text NOT NULL,
    code text NOT NULL,
    kind public."ProviderKind" DEFAULT 'TOPUP'::public."ProviderKind" NOT NULL,
    name text NOT NULL,
    status public."ProviderStatus" DEFAULT 'ACTIVE'::public."ProviderStatus" NOT NULL,
    "baseUrl" text,
    priority integer DEFAULT 0 NOT NULL,
    "lastSyncAt" timestamp(3) without time zone,
    "lastSyncStatus" text,
    balance integer,
    "balanceUpdatedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "catalogMeta" jsonb
);

CREATE TABLE public.sessions (
    id text NOT NULL,
    "tokenHash" text NOT NULL,
    "userId" text NOT NULL,
    "userVersion" integer DEFAULT 0 NOT NULL,
    ip text,
    "userAgent" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.transaction_logs (
    id text NOT NULL,
    "orderId" text,
    "requestId" text,
    event text NOT NULL,
    code text,
    message text,
    metadata jsonb,
    "durationMs" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.user_blocks (
    id text NOT NULL,
    "userId" text NOT NULL,
    reason text NOT NULL,
    "blockedById" text,
    "blockedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "unblockedAt" timestamp(3) without time zone,
    "unblockedById" text
);

CREATE TABLE public.users (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text,
    "passwordHash" text NOT NULL,
    role public."Role" DEFAULT 'MEMBER'::public."Role" NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    "blockedReason" text,
    "blockedAt" timestamp(3) without time zone,
    "sessionVersion" integer DEFAULT 0 NOT NULL,
    "lastLoginAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE public.webhook_events (
    id text NOT NULL,
    "providerCode" text NOT NULL,
    "externalId" text NOT NULL,
    "eventType" text,
    "orderId" text,
    "payloadHash" text NOT NULL,
    "processedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public."_ProductVariantToPromo"
    ADD CONSTRAINT "_ProductVariantToPromo_AB_pkey" PRIMARY KEY ("A", "B");

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT promo_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.promos
    ADD CONSTRAINT promos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provider_products
    ADD CONSTRAINT provider_products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transaction_logs
    ADD CONSTRAINT transaction_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);

CREATE INDEX "_ProductVariantToPromo_B_index" ON public."_ProductVariantToPromo" USING btree ("B");

CREATE INDEX "audit_logs_action_createdAt_idx" ON public.audit_logs USING btree (action, "createdAt");

CREATE INDEX "audit_logs_actorId_createdAt_idx" ON public.audit_logs USING btree ("actorId", "createdAt");

CREATE INDEX "audit_logs_targetType_targetId_idx" ON public.audit_logs USING btree ("targetType", "targetId");

CREATE INDEX "categories_isActive_sortOrder_idx" ON public.categories USING btree ("isActive", "sortOrder");

CREATE UNIQUE INDEX categories_kind_key ON public.categories USING btree (kind);

CREATE UNIQUE INDEX categories_slug_key ON public.categories USING btree (slug);

CREATE INDEX "games_categoryId_isActive_sortOrder_idx" ON public.games USING btree ("categoryId", "isActive", "sortOrder");

CREATE INDEX "games_isActive_isPopular_idx" ON public.games USING btree ("isActive", "isPopular");

CREATE INDEX games_slug_idx ON public.games USING btree (slug);

CREATE UNIQUE INDEX games_slug_key ON public.games USING btree (slug);

CREATE INDEX "order_items_orderId_idx" ON public.order_items USING btree ("orderId");

CREATE INDEX "order_items_productVariantId_idx" ON public.order_items USING btree ("productVariantId");

CREATE INDEX "orders_createdAt_idx" ON public.orders USING btree ("createdAt");

CREATE INDEX orders_invoice_idx ON public.orders USING btree (invoice);

CREATE UNIQUE INDEX orders_invoice_key ON public.orders USING btree (invoice);

CREATE UNIQUE INDEX "orders_providerId_providerRef_key" ON public.orders USING btree ("providerId", "providerRef");

CREATE INDEX "orders_status_createdAt_idx" ON public.orders USING btree (status, "createdAt");

CREATE INDEX "orders_status_expiresAt_idx" ON public.orders USING btree (status, "expiresAt");

CREATE INDEX "orders_userId_createdAt_idx" ON public.orders USING btree ("userId", "createdAt");

CREATE UNIQUE INDEX "orders_userId_idempotencyKey_key" ON public.orders USING btree ("userId", "idempotencyKey");

CREATE INDEX "payments_createdAt_idx" ON public.payments USING btree ("createdAt");

CREATE UNIQUE INDEX "payments_orderId_key" ON public.payments USING btree ("orderId");

CREATE UNIQUE INDEX "payments_providerCode_reference_key" ON public.payments USING btree ("providerCode", reference);

CREATE INDEX "payments_status_expiresAt_idx" ON public.payments USING btree (status, "expiresAt");

CREATE INDEX "product_variants_isActive_idx" ON public.product_variants USING btree ("isActive");

CREATE INDEX "product_variants_productId_isActive_sortOrder_idx" ON public.product_variants USING btree ("productId", "isActive", "sortOrder");

CREATE UNIQUE INDEX "product_variants_productId_slug_key" ON public.product_variants USING btree ("productId", slug);

CREATE INDEX "products_gameId_isActive_sortOrder_idx" ON public.products USING btree ("gameId", "isActive", "sortOrder");

CREATE UNIQUE INDEX "products_gameId_slug_key" ON public.products USING btree ("gameId", slug);

CREATE UNIQUE INDEX promo_codes_code_key ON public.promo_codes USING btree (code);

CREATE INDEX "promo_codes_promoId_isActive_idx" ON public.promo_codes USING btree ("promoId", "isActive");

CREATE INDEX "promos_isActive_startsAt_endsAt_idx" ON public.promos USING btree ("isActive", "startsAt", "endsAt");

CREATE INDEX promos_slug_idx ON public.promos USING btree (slug);

CREATE UNIQUE INDEX promos_slug_key ON public.promos USING btree (slug);

CREATE INDEX "provider_products_isAvailable_idx" ON public.provider_products USING btree ("isAvailable");

CREATE INDEX "provider_products_productVariantId_idx" ON public.provider_products USING btree ("productVariantId");

CREATE UNIQUE INDEX "provider_products_providerId_productVariantId_key" ON public.provider_products USING btree ("providerId", "productVariantId");

CREATE UNIQUE INDEX "provider_products_providerId_providerCode_key" ON public.provider_products USING btree ("providerId", "providerCode");

CREATE UNIQUE INDEX providers_code_key ON public.providers USING btree (code);

CREATE INDEX providers_kind_status_priority_idx ON public.providers USING btree (kind, status, priority);

CREATE INDEX "sessions_expiresAt_idx" ON public.sessions USING btree ("expiresAt");

CREATE UNIQUE INDEX "sessions_tokenHash_key" ON public.sessions USING btree ("tokenHash");

CREATE INDEX "sessions_userId_idx" ON public.sessions USING btree ("userId");

CREATE INDEX "transaction_logs_event_createdAt_idx" ON public.transaction_logs USING btree (event, "createdAt");

CREATE INDEX "transaction_logs_orderId_createdAt_idx" ON public.transaction_logs USING btree ("orderId", "createdAt");

CREATE INDEX "transaction_logs_requestId_idx" ON public.transaction_logs USING btree ("requestId");

CREATE INDEX "user_blocks_userId_unblockedAt_idx" ON public.user_blocks USING btree ("userId", "unblockedAt");

CREATE INDEX "users_createdAt_idx" ON public.users USING btree ("createdAt");

CREATE INDEX users_email_idx ON public.users USING btree (email);

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

CREATE INDEX users_role_status_idx ON public.users USING btree (role, status);

CREATE INDEX "webhook_events_orderId_idx" ON public.webhook_events USING btree ("orderId");

CREATE UNIQUE INDEX "webhook_events_providerCode_externalId_key" ON public.webhook_events USING btree ("providerCode", "externalId");

ALTER TABLE ONLY public."_ProductVariantToPromo"
    ADD CONSTRAINT "_ProductVariantToPromo_A_fkey" FOREIGN KEY ("A") REFERENCES public.product_variants(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."_ProductVariantToPromo"
    ADD CONSTRAINT "_ProductVariantToPromo_B_fkey" FOREIGN KEY ("B") REFERENCES public.promos(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.games
    ADD CONSTRAINT "games_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT "order_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES public.product_variants(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT "orders_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES public.providers(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.products
    ADD CONSTRAINT "products_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES public.games(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT "promo_codes_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES public.promos(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.promos
    ADD CONSTRAINT "promos_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.provider_products
    ADD CONSTRAINT "provider_products_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES public.product_variants(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_products
    ADD CONSTRAINT "provider_products_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES public.providers(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.transaction_logs
    ADD CONSTRAINT "transaction_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- =============================================================================
-- Prisma migration bookkeeping
--
-- Tabel _prisma_migrations di atas dibuat oleh dump, di sini hanya diisi
-- barisnya. Menandai ketiga migrasi sebagai sudah diterapkan. Tanpa ini,
-- `prisma migrate deploy` akan mencoba CREATE TYPE/TABLE lagi dan gagal
-- dengan "type already exists". Checksum di bawah adalah sha256 asli dari
-- tiap file migration.sql di prisma/migrations/.
-- =============================================================================
INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, started_at, applied_steps_count, migration_name)
VALUES
    (gen_random_uuid()::text,
     'eba77115cb66be185840918d29d7aa4f83b49c6e89c8b5e99bdc941e3862e73e',
     now(), now(), 1, '20260925075826_init'),
    (gen_random_uuid()::text,
     '5a2c7b670af416e8670150450f89ef1401a032dbb72d0ce54d962ae59fcb9428',
     now(), now(), 1, '20260925081131_app_setting_table_name'),
    (gen_random_uuid()::text,
     '78f9473e20dd1f6b39986ddb8d068966b0648e23c26a31d859107416ecae3094',
     now(), now(), 1, '20260925082426_provider_catalog_meta');


-- =============================================================================
-- Lockdown: tabel aplikasi tidak boleh terekspos lewat PostgREST.
--
-- Di-guard dengan pg_roles supaya file ini juga aman dijalankan di Postgres
-- lokal biasa (di sana role anon/authenticated tidak ada).
-- =============================================================================
ALTER TABLE public."users"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sessions"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."categories"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."games"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."products"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."product_variants"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."providers"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."provider_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."orders"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."order_items"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."payments"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."transaction_logs"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."promos"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."promo_codes"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_logs"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_blocks"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."webhook_events"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."app_settings"      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;

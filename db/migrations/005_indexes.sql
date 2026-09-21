-- 005_indexes.sql — Índices
-- Afirmative Pill
--
-- Dos grupos:
--   (a) índices sobre las FK que consultan los DataLoaders con `= any($1)` — son los que
--       convierten el batch de N claves en un Index Scan y no en un Seq Scan;
--   (b) índices de búsqueda facetada sobre la proyección del catálogo.

-- pg_trgm vive fuera de `public` (recomendación del linter de Supabase: las extensiones no
-- deben contaminar el esquema de la aplicación).
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- (a) claves foráneas del write model — Postgres NO las indexa solo
create index if not exists medications_active_ingredient_id_idx on public.medications (active_ingredient_id);
create index if not exists medications_category_id_idx          on public.medications (category_id);
create index if not exists medications_laboratory_id_idx        on public.medications (laboratory_id);

create index if not exists cart_items_cart_id_idx               on public.cart_items (cart_id);
create index if not exists cart_items_medication_id_idx         on public.cart_items (medication_id);
create index if not exists carts_patient_id_idx                 on public.carts (patient_id);

create index if not exists order_items_order_id_idx             on public.order_items (order_id);
create index if not exists order_items_medication_id_idx        on public.order_items (medication_id);
create index if not exists orders_patient_id_idx                on public.orders (patient_id);
create index if not exists orders_cart_id_idx                   on public.orders (cart_id);

create index if not exists prescriptions_cart_id_idx            on public.prescriptions (cart_id);
create index if not exists prescriptions_order_id_idx           on public.prescriptions (order_id);

create index if not exists stock_reservations_order_id_idx      on public.stock_reservations (order_id);
create index if not exists stock_reservations_medication_id_idx on public.stock_reservations (medication_id);

-- Outbox: el projector solo busca lo no procesado. Índice PARCIAL — ocupa lo que ocupe la
-- cola pendiente (casi siempre vacía), no la historia completa de eventos.
create index if not exists domain_events_unprocessed_idx
  on public.domain_events (id)
  where processed_at is null;

create index if not exists domain_events_aggregate_idx
  on public.domain_events (aggregate_type, aggregate_id, id);

-- (b) lectura del catálogo
create index if not exists medication_catalog_search_idx
  on public.medication_catalog_projection using gin (search_vector);

-- Búsqueda por subcadena tolerante a typos en el nombre comercial ("ibupro" -> "Ibuprofeno Max")
create index if not exists medication_catalog_name_trgm_idx
  on public.medication_catalog_projection using gin (name extensions.gin_trgm_ops);

create index if not exists medication_catalog_category_idx
  on public.medication_catalog_projection (category_id);

create index if not exists medication_catalog_ingredient_idx
  on public.medication_catalog_projection (active_ingredient_id);

-- Orden por precio con paginación estable (price, medication_id como desempate)
create index if not exists medication_catalog_price_idx
  on public.medication_catalog_projection (price, medication_id);

create index if not exists medication_catalog_name_sort_idx
  on public.medication_catalog_projection (name, medication_id);

-- Filtro "solo disponibles": índice parcial, el 90% de las consultas del catálogo lo usan
create index if not exists medication_catalog_in_stock_idx
  on public.medication_catalog_projection (medication_id)
  where in_stock;

-- Historial del paciente, más reciente primero
create index if not exists order_projection_patient_idx
  on public.order_projection (patient_id, placed_at desc);

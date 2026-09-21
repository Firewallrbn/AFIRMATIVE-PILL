-- 004_projections.sql — Read model (proyecciones desnormalizadas)
-- Afirmative Pill · CQRS read side
--
-- Ningún resolver de Query toca las tablas normalizadas del write model. Estas dos
-- proyecciones son las únicas fuentes de lectura, y están desnormalizadas a propósito:
-- resuelven las pantallas del Escenario A y del Escenario C sin un solo JOIN.

-- ------------------------------------------------- catálogo (Escenario A)
create table if not exists public.medication_catalog_projection (
  medication_id          bigint primary key references public.medications (id) on delete cascade,
  sku                    text          not null,
  name                   text          not null,
  active_ingredient      text          not null,
  active_ingredient_id   bigint        not null,
  category               text          not null,
  category_id            bigint        not null,
  category_slug          text          not null,
  laboratory             text          not null,
  laboratory_id          bigint        not null,
  dosage                 text          not null,
  presentation           text          not null,
  price                  numeric(12,2) not null,
  stock                  integer       not null,
  in_stock               boolean       not null,
  requires_prescription  boolean       not null,
  description            text          not null,
  projected_at           timestamptz   not null default now(),
  -- Búsqueda por nombre comercial, principio activo y categoría terapéutica en una sola
  -- columna indexable. Diccionario español: maneja acentos y raíces del castellano.
  search_vector tsvector generated always as (
    to_tsvector(
      'spanish',
      coalesce(name, '') || ' ' ||
      coalesce(active_ingredient, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(laboratory, '') || ' ' ||
      coalesce(description, '')
    )
  ) stored
);

-- ------------------------------------------------- órdenes (Escenario C)
create table if not exists public.order_projection (
  order_id             bigint primary key references public.orders (id) on delete cascade,
  patient_id           text          not null,
  status               text          not null,
  total                numeric(12,2) not null,
  -- El detalle de ítems viaja embebido: la pantalla de seguimiento se resuelve con un
  -- único SELECT por order_id, sin JOIN contra order_items ni medications.
  items                jsonb         not null default '[]'::jsonb,
  prescription_status  text          not null default 'NOT_REQUIRED',
  requires_prescription boolean      not null default false,
  cancellation_reason  text,
  placed_at            timestamptz   not null,
  updated_at           timestamptz   not null default now(),
  -- Versión de la proyección: sube con cada evento aplicado. Permite al cliente saber si
  -- lo que ve ya incorporó el último comando o sigue en camino (freshness).
  projection_version   bigint        not null default 0
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_projection_status_valid') then
    alter table public.order_projection add constraint order_projection_status_valid
      check (status in ('PENDING_APPROVAL', 'APPROVED', 'DISPATCHED', 'CANCELLED'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_projection_prescription_status_valid') then
    alter table public.order_projection add constraint order_projection_prescription_status_valid
      check (prescription_status in ('NOT_REQUIRED', 'PENDING_VALIDATION', 'VALIDATED', 'REJECTED'));
  end if;
end $$;

-- Cada escritura de la proyección dispara NOTIFY: así la Subscription empuja el cambio
-- al cliente en el mismo instante en que el read model queda consistente (no antes).
drop trigger if exists order_projection_notify on public.order_projection;
create trigger order_projection_notify
  after insert or update on public.order_projection
  for each row execute function public.notify_order_changed();

alter table public.medication_catalog_projection enable row level security;
alter table public.order_projection              enable row level security;

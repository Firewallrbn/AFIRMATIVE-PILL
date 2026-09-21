-- 002_ordering.sql — Write model transaccional (carritos, recetas, órdenes, reservas)
-- Afirmative Pill · CQRS write side
--
-- Estas tablas SOLO las tocan los command handlers. Ningún resolver de Query las lee:
-- las lecturas van contra las proyecciones de 004_projections.sql.

-- ---------------------------------------------------------------- carritos
create table if not exists public.carts (
  id          bigint generated always as identity primary key,
  patient_id  text        not null,
  status      text        not null default 'OPEN',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.cart_items (
  id             bigint generated always as identity primary key,
  cart_id        bigint  not null references public.carts (id) on delete cascade,
  medication_id  bigint  not null references public.medications (id),
  quantity       integer not null,
  added_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- órdenes
create table if not exists public.orders (
  id               bigint generated always as identity primary key,
  patient_id       text          not null,
  cart_id          bigint        references public.carts (id),
  status           text          not null default 'PENDING_APPROVAL',
  total            numeric(12,2) not null default 0,
  idempotency_key  text          not null unique,
  cancellation_reason text,
  placed_at        timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

create table if not exists public.order_items (
  id             bigint generated always as identity primary key,
  order_id       bigint        not null references public.orders (id) on delete cascade,
  medication_id  bigint        not null references public.medications (id),
  quantity       integer       not null,
  unit_price     numeric(12,2) not null,
  line_total     numeric(12,2) generated always as (unit_price * quantity) stored
);

-- ---------------------------------------------------------------- recetas
-- Una receta puede nacer adjunta a un carrito y luego quedar ligada a la orden emitida.
create table if not exists public.prescriptions (
  id               bigint generated always as identity primary key,
  cart_id          bigint      references public.carts (id) on delete cascade,
  order_id         bigint      references public.orders (id) on delete cascade,
  doctor_name      text        not null,
  medical_license  text        not null,
  issued_at        date        not null,
  document_url     text        not null,
  status           text        not null default 'PENDING_VALIDATION',
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- reservas de inventario
-- Traza de cuánto stock quedó comprometido por cada orden: permite devolver el inventario
-- cuando una orden se cancela, sin recalcular nada.
create table if not exists public.stock_reservations (
  id             bigint generated always as identity primary key,
  order_id       bigint  not null references public.orders (id) on delete cascade,
  medication_id  bigint  not null references public.medications (id),
  quantity       integer not null,
  reserved_at    timestamptz not null default now(),
  released_at    timestamptz
);

-- ---------------------------------------------------------------- invariantes
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'carts_status_valid') then
    alter table public.carts add constraint carts_status_valid
      check (status in ('OPEN', 'CHECKED_OUT', 'ABANDONED'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cart_items_quantity_positive') then
    alter table public.cart_items add constraint cart_items_quantity_positive
      check (quantity > 0);
  end if;

  -- un medicamento aparece una sola vez por carrito: agregar dos veces suma cantidad
  if not exists (select 1 from pg_constraint where conname = 'cart_items_unique_medication') then
    alter table public.cart_items add constraint cart_items_unique_medication
      unique (cart_id, medication_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_status_valid') then
    alter table public.orders add constraint orders_status_valid
      check (status in ('PENDING_APPROVAL', 'APPROVED', 'DISPATCHED', 'CANCELLED'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_total_non_negative') then
    alter table public.orders add constraint orders_total_non_negative
      check (total >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_items_quantity_positive') then
    alter table public.order_items add constraint order_items_quantity_positive
      check (quantity > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'prescriptions_status_valid') then
    alter table public.prescriptions add constraint prescriptions_status_valid
      check (status in ('PENDING_VALIDATION', 'VALIDATED', 'REJECTED'));
  end if;

  -- una receta pertenece a un carrito o a una orden, nunca a ninguno de los dos
  if not exists (select 1 from pg_constraint where conname = 'prescriptions_has_owner') then
    alter table public.prescriptions add constraint prescriptions_has_owner
      check (cart_id is not null or order_id is not null);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'stock_reservations_quantity_positive') then
    alter table public.stock_reservations add constraint stock_reservations_quantity_positive
      check (quantity > 0);
  end if;
end $$;

drop trigger if exists carts_set_updated_at on public.carts;
create trigger carts_set_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.carts              enable row level security;
alter table public.cart_items         enable row level security;
alter table public.orders             enable row level security;
alter table public.order_items        enable row level security;
alter table public.prescriptions      enable row level security;
alter table public.stock_reservations enable row level security;

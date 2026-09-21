-- 001_catalog.sql — Write model del catálogo (fuente de verdad)
-- Afirmative Pill · CQRS write side
--
-- Normalizamos el dataset plano de 50 medicamentos en 4 tablas. Esa normalización es
-- deliberada: es la que genera el problema N+1 en los resolvers anidados
-- (medication -> activeIngredient / category / laboratory) que luego mitigamos con DataLoader.

create table if not exists public.laboratories (
  id          bigint generated always as identity primary key,
  name        text        not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.active_ingredients (
  id          bigint generated always as identity primary key,
  name        text        not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.categories (
  id          bigint generated always as identity primary key,
  name        text        not null unique,
  slug        text        not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.medications (
  id                    bigint generated always as identity primary key,
  sku                   text          not null unique,
  name                  text          not null,
  active_ingredient_id  bigint        not null references public.active_ingredients (id),
  category_id           bigint        not null references public.categories (id),
  laboratory_id         bigint        not null references public.laboratories (id),
  dosage                text          not null,
  presentation          text          not null,
  price                 numeric(12,2) not null,
  stock                 integer       not null,
  requires_prescription boolean       not null default false,
  description           text          not null,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

-- Invariantes de bodega a nivel de motor: el stock nunca puede quedar negativo aunque
-- falle la capa de aplicación. Es la última línea de defensa del comando PlaceOrder.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'medications_stock_non_negative') then
    alter table public.medications
      add constraint medications_stock_non_negative check (stock >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'medications_price_non_negative') then
    alter table public.medications
      add constraint medications_price_non_negative check (price >= 0);
  end if;
end $$;

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists medications_set_updated_at on public.medications;
create trigger medications_set_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();

-- RLS activa y sin políticas: el acceso es exclusivamente por el servidor GraphQL con el rol
-- privilegiado. Las claves anon/publishable de Supabase no pueden leer nada por su cuenta,
-- lo que además refuerza el mandato Zero-REST (PostgREST queda inutilizable para el cliente).
alter table public.laboratories       enable row level security;
alter table public.active_ingredients enable row level security;
alter table public.categories         enable row level security;
alter table public.medications        enable row level security;

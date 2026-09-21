-- 003_events.sql — Outbox de eventos de dominio
-- Afirmative Pill · puente entre el write model y el read model
--
-- El command handler inserta el evento DENTRO de la misma transacción que modifica el estado.
-- Si el commit falla, no hay evento; si el commit pasa, el evento existe. El projector lo
-- consume después (patrón transactional outbox) y de ahí nace la consistencia eventual.

create table if not exists public.domain_events (
  id              bigint generated always as identity primary key,
  aggregate_type  text        not null,
  aggregate_id    text        not null,
  event_type      text        not null,
  payload         jsonb       not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  processed_at    timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'domain_events_type_valid') then
    alter table public.domain_events add constraint domain_events_type_valid
      check (event_type in (
        'CartCreated',
        'MedicationAddedToCart',
        'PrescriptionAttached',
        'OrderPlaced',
        'OrderApproved',
        'OrderDispatched',
        'OrderCancelled'
      ));
  end if;
end $$;

-- Canal de notificación que alimenta las GraphQL Subscriptions.
-- El projector emite NOTIFY tras actualizar la proyección; el servidor GraphQL escucha
-- con LISTEN y empuja el cambio al cliente por SSE. Sin polling desde el cliente.
create or replace function public.notify_order_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify('order_changed', new.order_id::text);
  return new;
end;
$$;

alter table public.domain_events enable row level security;

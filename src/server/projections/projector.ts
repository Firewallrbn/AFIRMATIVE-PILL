import { db } from '@/server/shared/db';
import { logger } from '@/server/shared/logger';

/**
 * ============================================================================
 *  PROJECTOR — el puente entre el write model y el read model
 * ============================================================================
 *
 * Lee el outbox (`domain_events`), reconstruye las proyecciones afectadas y marca los
 * eventos como procesados. Es lo que hace que la consistencia de este sistema sea
 * *eventual* y no inmediata: entre el COMMIT del comando y la actualización de la
 * proyección hay un intervalo real, observable y medible.
 *
 * Cómo se dispara en serverless (no hay proceso residente donde poner un worker):
 *
 *   1. Tras cada comando, `waitUntil(drainOutbox())` lo ejecuta DESPUÉS de enviar la
 *      respuesta HTTP — el paciente no espera a la proyección.
 *   2. Como red de seguridad, `Query.order` también lo dispara si detecta eventos
 *      pendientes: si una instancia se congeló a mitad de camino, la siguiente lectura
 *      pone la proyección al día.
 *
 * `PROJECTION_DELAY_MS` agrega una demora deliberada (1.2 s por defecto). No es un
 * defecto: es lo que hace VISIBLE en la sustentación el estado `SYNCING` de la UI.
 * En producción se pondría en 0.
 */

const PROJECTION_DELAY_MS = Number(process.env.PROJECTION_DELAY_MS ?? 1200);
const BATCH_SIZE = 50;

type EventRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reconstruye por completo la proyección de una orden a partir del write model.
 *
 * Reconstrucción total y no incremental a propósito: un projector idempotente se puede
 * re-ejecutar sobre los mismos eventos sin corromper nada, que es justo lo que uno
 * necesita cuando la entrega de eventos es "al menos una vez".
 */
async function projectOrder(orderId: string): Promise<void> {
  const sql = db();
  await sql`
    insert into public.order_projection
      (order_id, patient_id, status, total, items, prescription_status,
       requires_prescription, cancellation_reason, placed_at, updated_at, projection_version)
    select
      o.id,
      o.patient_id,
      o.status,
      o.total,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'medicationId', oi.medication_id::text,
            'name',         m.name,
            'quantity',     oi.quantity,
            'unitPrice',    oi.unit_price,
            'lineTotal',    oi.line_total
          ) order by oi.id
        ) filter (where oi.id is not null),
        '[]'::jsonb
      ),
      coalesce(
        max(p.status),
        case when bool_or(m.requires_prescription) then 'PENDING_VALIDATION' else 'NOT_REQUIRED' end
      ),
      coalesce(bool_or(m.requires_prescription), false),
      o.cancellation_reason,
      o.placed_at,
      now(),
      1
    from public.orders o
    left join public.order_items   oi on oi.order_id = o.id
    left join public.medications   m  on m.id = oi.medication_id
    left join public.prescriptions p  on p.order_id = o.id
    where o.id = ${Number(orderId)}
    group by o.id, o.patient_id, o.status, o.total, o.cancellation_reason, o.placed_at
    on conflict (order_id) do update set
      status                = excluded.status,
      total                 = excluded.total,
      items                 = excluded.items,
      prescription_status   = excluded.prescription_status,
      requires_prescription = excluded.requires_prescription,
      cancellation_reason   = excluded.cancellation_reason,
      updated_at            = now(),
      projection_version    = public.order_projection.projection_version + 1
  `;
}

/**
 * Refresca precio y disponibilidad en la proyección del catálogo.
 *
 * Es la otra mitad de la consistencia eventual, la que el paciente percibe como "el
 * stock del catálogo tardó un segundo en bajar después de mi compra".
 */
async function refreshCatalog(medicationIds: string[]): Promise<void> {
  if (medicationIds.length === 0) return;
  const sql = db();
  await sql`
    update public.medication_catalog_projection p
       set stock        = m.stock,
           in_stock     = m.stock > 0,
           price        = m.price,
           projected_at = now()
      from public.medications m
     where m.id = p.medication_id
       and m.id = any(${medicationIds.map(Number)})
  `;
}

async function medicationIdsForOrder(orderId: string): Promise<string[]> {
  const sql = db();
  const rows = await sql<{ medication_id: string }[]>`
    select medication_id::text from public.order_items where order_id = ${Number(orderId)}
  `;
  return rows.map((row) => row.medication_id);
}

/**
 * Procesa el outbox.
 *
 * `for update skip locked` es lo que permite que dos instancias de la función corran el
 * projector a la vez sin pisarse: cada una toma eventos distintos en lugar de bloquearse
 * o de procesar el mismo evento dos veces.
 */
export async function drainOutbox(): Promise<number> {
  if (PROJECTION_DELAY_MS > 0) await sleep(PROJECTION_DELAY_MS);

  const sql = db();
  const startedAt = Date.now();

  const events = (await sql.begin(async (tx): Promise<EventRow[]> => {
    const pending = await tx<EventRow[]>`
      select id::text, aggregate_type, aggregate_id, event_type
      from public.domain_events
      where processed_at is null
      order by id asc
      limit ${BATCH_SIZE}
      for update skip locked
    `;
    if (pending.length === 0) return [];

    await tx`
      update public.domain_events
         set processed_at = now()
       where id = any(${pending.map((event) => Number(event.id))})
    `;
    return pending;
  })) as EventRow[];

  if (events.length === 0) return 0;

  const orderIds = [
    ...new Set(events.filter((e) => e.aggregate_type === 'Order').map((e) => e.aggregate_id)),
  ];

  for (const orderId of orderIds) {
    await projectOrder(orderId);
    // Solo estos dos eventos mueven inventario; el resto no necesita tocar el catálogo.
    const movesStock = events.some(
      (e) =>
        e.aggregate_id === orderId &&
        (e.event_type === 'OrderPlaced' || e.event_type === 'OrderCancelled'),
    );
    if (movesStock) await refreshCatalog(await medicationIdsForOrder(orderId));
  }

  logger.info(
    {
      events: events.length,
      orders: orderIds.length,
      ms: Date.now() - startedAt,
      delayMs: PROJECTION_DELAY_MS,
    },
    `[projector] ${events.length} evento(s) proyectado(s) — read model al día`,
  );

  return events.length;
}

/**
 * Drenado perezoso: lo llama el read side cuando detecta que la proyección que está por
 * devolver tiene eventos pendientes. Sin `await` en el camino crítico de la lectura.
 */
export function drainInBackground(reason: string): void {
  drainOutbox().catch((error) => {
    logger.error({ err: error, reason }, '[projector] fallo al drenar el outbox');
  });
}

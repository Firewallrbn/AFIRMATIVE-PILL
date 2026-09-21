import { db } from '@/server/shared/db';
import { logger } from '@/server/shared/logger';
import { invalidState, notFound, type CommandErrorShape } from '@/server/shared/errors';
import { canTransition } from '../domain/invariants';

/**
 * ============================================================================
 *  COMANDOS de ciclo de vida de la orden
 * ============================================================================
 *
 * `approveOrder` / `dispatchOrder` / `cancelOrder` son los comandos del back-office
 * farmacéutico. En producción los ejecutaría el químico farmacéutico o el operador de
 * bodega desde su propio panel; acá se exponen en el mismo schema para poder demostrar
 * en vivo el flujo completo de estados y las Subscriptions.
 *
 * Los tres comparten la misma forma: verifican que la transición sea legal, escriben el
 * nuevo estado y registran el evento en el outbox — todo en una transacción.
 */

export type LifecycleResult = { orderId: string | null; errors: CommandErrorShape[] };

type OrderRow = { id: string; status: string; patient_id: string };

async function loadOrder(orderId: string): Promise<OrderRow | null> {
  const sql = db();
  const [order] = await sql<OrderRow[]>`
    select id::text, status, patient_id
    from public.orders
    where id = ${Number(orderId)}
  `;
  return order ?? null;
}

/** Validación farmacéutica conforme: la receta queda VALIDATED y la orden APPROVED. */
export async function approveOrder(orderId: string): Promise<LifecycleResult> {
  const order = await loadOrder(orderId);
  if (!order) return { orderId: null, errors: [notFound('la orden', orderId)] };

  if (!canTransition(order.status, 'APPROVED')) {
    return {
      orderId: null,
      errors: [
        invalidState(
          order.status,
          'APPROVED',
          `Una orden en estado ${order.status} no puede aprobarse.`,
        ),
      ],
    };
  }

  const sql = db();
  await sql.begin(async (tx) => {
    await tx`update public.orders set status = 'APPROVED' where id = ${Number(orderId)}`;
    await tx`
      update public.prescriptions set status = 'VALIDATED'
      where order_id = ${Number(orderId)}
    `;
    await tx`
      insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
      values ('Order', ${orderId}, 'OrderApproved', ${sql.json({ approvedAt: new Date().toISOString() })})
    `;
  });

  logger.info({ orderId }, '[command] approveOrder — validación farmacéutica conforme');
  return { orderId, errors: [] };
}

/** Salida de bodega. */
export async function dispatchOrder(orderId: string): Promise<LifecycleResult> {
  const order = await loadOrder(orderId);
  if (!order) return { orderId: null, errors: [notFound('la orden', orderId)] };

  if (!canTransition(order.status, 'DISPATCHED')) {
    return {
      orderId: null,
      errors: [
        invalidState(
          order.status,
          'DISPATCHED',
          order.status === 'PENDING_APPROVAL'
            ? 'No se puede despachar una orden que todavía no pasó validación farmacéutica.'
            : `Una orden en estado ${order.status} no puede despacharse.`,
        ),
      ],
    };
  }

  const sql = db();
  await sql.begin(async (tx) => {
    await tx`update public.orders set status = 'DISPATCHED' where id = ${Number(orderId)}`;
    await tx`
      insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
      values ('Order', ${orderId}, 'OrderDispatched', ${sql.json({ dispatchedAt: new Date().toISOString() })})
    `;
  });

  logger.info({ orderId }, '[command] dispatchOrder — orden despachada');
  return { orderId, errors: [] };
}

/**
 * Anulación. Lo importante acá es que el inventario VUELVE a bodega: una reserva que no
 * se libera es stock fantasma, que en este dominio significa negarle un medicamento a
 * alguien que sí lo necesita.
 */
export async function cancelOrder(orderId: string, reason: string): Promise<LifecycleResult> {
  const order = await loadOrder(orderId);
  if (!order) return { orderId: null, errors: [notFound('la orden', orderId)] };

  if (!canTransition(order.status, 'CANCELLED')) {
    return {
      orderId: null,
      errors: [
        invalidState(
          order.status,
          'CANCELLED',
          order.status === 'DISPATCHED'
            ? 'La orden ya fue despachada; corresponde una devolución, no una anulación.'
            : 'La orden ya estaba anulada.',
        ),
      ],
    };
  }

  const sql = db();
  await sql.begin(async (tx) => {
    const reservations = await tx<{ medication_id: string; quantity: number }[]>`
      select medication_id::text, quantity
      from public.stock_reservations
      where order_id = ${Number(orderId)} and released_at is null
      for update
    `;

    for (const reservation of reservations) {
      await tx`
        update public.medications
           set stock = stock + ${reservation.quantity}
         where id = ${Number(reservation.medication_id)}
      `;
    }

    await tx`
      update public.stock_reservations set released_at = now()
      where order_id = ${Number(orderId)} and released_at is null
    `;
    await tx`
      update public.orders
         set status = 'CANCELLED', cancellation_reason = ${reason}
       where id = ${Number(orderId)}
    `;
    await tx`
      insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
      values ('Order', ${orderId}, 'OrderCancelled', ${sql.json({
        reason,
        releasedItems: reservations.length,
      })})
    `;
  });

  logger.info({ orderId, reason }, '[command] cancelOrder — inventario devuelto a bodega');
  return { orderId, errors: [] };
}

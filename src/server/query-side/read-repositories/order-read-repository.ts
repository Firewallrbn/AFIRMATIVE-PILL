import { db } from '@/server/shared/db';
import type { OrderModel } from '@/server/query-side/models';

/**
 * Repositorio de LECTURA de pedidos: lee `order_projection` y nada más.
 *
 * El contraste con el write side es el punto del ejercicio: para pintar la pantalla de
 * seguimiento no se toca `orders`, ni `order_items`, ni `medications`. Un SELECT por
 * clave primaria contra una tabla desnormalizada resuelve la vista completa.
 */

export type OrderProjectionRow = {
  order_id: string;
  patient_id: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'DISPATCHED' | 'CANCELLED';
  total: string;
  items: OrderProjectionItem[];
  prescription_status: 'NOT_REQUIRED' | 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED';
  requires_prescription: boolean;
  cancellation_reason: string | null;
  placed_at: Date;
  updated_at: Date;
  projection_version: string;
};

export type OrderProjectionItem = {
  medicationId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export const orderReadRepository = {
  async findById(orderId: string): Promise<OrderProjectionRow | null> {
    const sql = db();
    const [row] = await sql<OrderProjectionRow[]>`
      select order_id::text, patient_id, status, total, items, prescription_status,
             requires_prescription, cancellation_reason, placed_at, updated_at,
             projection_version::text
      from public.order_projection
      where order_id = ${Number(orderId)}
    `;
    return row ?? null;
  },

  /** Carga en lote: la usa el DataLoader de órdenes. */
  async findManyByIds(orderIds: readonly string[]): Promise<OrderProjectionRow[]> {
    const sql = db();
    return sql<OrderProjectionRow[]>`
      select order_id::text, patient_id, status, total, items, prescription_status,
             requires_prescription, cancellation_reason, placed_at, updated_at,
             projection_version::text
      from public.order_projection
      where order_id = any(${orderIds.map(Number)})
    `;
  },

  async findByPatient(patientId: string, limit: number): Promise<OrderProjectionRow[]> {
    const sql = db();
    return sql<OrderProjectionRow[]>`
      select order_id::text, patient_id, status, total, items, prescription_status,
             requires_prescription, cancellation_reason, placed_at, updated_at,
             projection_version::text
      from public.order_projection
      where patient_id = ${patientId}
      order by placed_at desc
      limit ${limit}
    `;
  },

  /**
   * ¿Quedan eventos sin proyectar para esta orden?
   *
   * De aquí sale el campo `freshness` del contrato: si el outbox todavía tiene eventos
   * pendientes para el agregado, la proyección que estamos devolviendo está atrasada y
   * el cliente merece saberlo.
   */
  async hasPendingEvents(orderIds: readonly string[]): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set();
    const sql = db();
    const rows = await sql<{ aggregate_id: string }[]>`
      select distinct aggregate_id
      from public.domain_events
      where aggregate_type = 'Order'
        and processed_at is null
        and aggregate_id = any(${orderIds.map(String)})
    `;
    return new Set(rows.map((r) => r.aggregate_id));
  },
};


/**
 * ------------------------------------------------------------------------------------
 *  FALLBACK de read-your-writes
 * ------------------------------------------------------------------------------------
 *
 * Única lectura de todo el read side que toca el modelo transaccional, y está acá
 * arriba, a la vista, en vez de escondida.
 *
 * El motivo: entre el COMMIT de `placeOrder` y la escritura del projector hay una
 * ventana real (`PROJECTION_DELAY_MS`). Si el paciente entra a "mi pedido" dentro de esa
 * ventana, `order_projection` todavía no tiene fila y devolver `null` sería técnicamente
 * correcto y pésimo: acaba de comprar y vería "pedido no encontrado".
 *
 * Entonces se reconstruye la vista desde el write model y se devuelve marcada como
 * `SYNCING` — el dato es real y la UI dice con todas las letras que todavía se está
 * consolidando. Es consistencia eventual manejada, no disimulada.
 */
type Row = {
  id: string;
  patient_id: string;
  status: string;
  total: string;
  cancellation_reason: string | null;
  placed_at: Date;
  updated_at: Date;
  requires_prescription: boolean;
  prescription_status: string;
  items: {
    medicationId: string;
    name: string;
    quantity: number;
    unitPrice: string | number;
    lineTotal: string | number;
  }[];
};

export async function readOrderFromWriteModel(orderId: string): Promise<OrderModel | null> {
  const sql = db();
  const [row] = await sql<Row[]>`
    select
      o.id::text,
      o.patient_id,
      o.status,
      o.total,
      o.cancellation_reason,
      o.placed_at,
      o.updated_at,
      coalesce(bool_or(m.requires_prescription), false) as requires_prescription,
      coalesce(
        max(p.status),
        case when bool_or(m.requires_prescription) then 'PENDING_VALIDATION' else 'NOT_REQUIRED' end
      ) as prescription_status,
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
      ) as items
    from public.orders o
    left join public.order_items   oi on oi.order_id = o.id
    left join public.medications   m  on m.id = oi.medication_id
    left join public.prescriptions p  on p.order_id = o.id
    where o.id = ${Number(orderId)}
    group by o.id, o.patient_id, o.status, o.total, o.cancellation_reason, o.placed_at, o.updated_at
  `;

  if (!row) return null;

  return {
    id: String(row.id),
    patientId: row.patient_id,
    status: row.status,
    total: Number(row.total),
    items: (row.items ?? []).map((item) => ({
      medicationId: String(item.medicationId),
      name: item.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
    requiresPrescription: row.requires_prescription,
    prescriptionStatus: row.prescription_status,
    cancellationReason: row.cancellation_reason,
    placedAt: row.placed_at,
    updatedAt: row.updated_at,
    version: 0,
  };
}

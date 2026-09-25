import { db } from '@/server/shared/db';
import { logger } from '@/server/shared/logger';
import { invalidState, notFound, outOfStock, validation, type CommandErrorShape } from '@/server/shared/errors';
import {
  calculateTotal,
  checkPrescription,
  checkStock,
  requiresPrescription,
  type OrderLine,
} from '../domain/invariants';
import { cartWriteRepository } from '../write-repositories/cart-write-repository';

/**
 * ============================================================================
 *  COMANDO: PlaceOrder — emitir el pedido
 * ============================================================================
 *
 * Es el comando crítico del sistema: compromete inventario real de un medicamento que
 * un paciente puede necesitar hoy. Todo lo que hace ocurre en UNA transacción:
 *
 *    BEGIN
 *      · bloquea las filas de los medicamentos involucrados (FOR UPDATE)
 *      · descuenta el stock con la condición `stock >= cantidad` en el propio UPDATE
 *      · crea la orden, sus ítems y las reservas de inventario
 *      · traslada la fórmula médica del carrito a la orden
 *      · cierra el carrito
 *      · escribe el evento OrderPlaced en el outbox
 *    COMMIT
 *
 * Si cualquier paso falla, no queda rastro: ni orden a medias ni stock descontado sin
 * orden. Y como el evento se inserta dentro de la misma transacción, es imposible que
 * exista una orden sin su evento o un evento sin su orden.
 */

export type PlaceOrderInput = {
  cartId: string;
  idempotencyKey: string;
};

export type PlaceOrderResult = {
  orderId: string | null;
  errors: CommandErrorShape[];
};

/** Error interno que aborta la transacción llevando consigo los errores de dominio. */
class DomainAbort extends Error {
  constructor(public readonly errors: CommandErrorShape[]) {
    super('Comando abortado por invariante de dominio');
  }
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const sql = db();

  if (!input.idempotencyKey?.trim()) {
    return { orderId: null, errors: [validation('idempotencyKey', 'La clave de idempotencia es obligatoria.')] };
  }

  // ---------------------------------------------------------------- idempotencia
  // Un doble clic, un reintento del navegador o un retry de red no pueden producir dos
  // dispensaciones del mismo medicamento. Si la clave ya existe, devolvemos la orden
  // que ya se creó en lugar de crear otra.
  const [existing] = await sql<{ id: string }[]>`
    select id::text from public.orders where idempotency_key = ${input.idempotencyKey}
  `;
  if (existing) {
    logger.info({ orderId: existing.id }, '[command] placeOrder — idempotente, la orden ya existía');
    return { orderId: existing.id, errors: [] };
  }

  // ---------------------------------------------------------------- carga del agregado
  const cart = await cartWriteRepository.findById(input.cartId);
  if (!cart) return { orderId: null, errors: [notFound('el carrito', input.cartId)] };
  if (cart.status !== 'OPEN') {
    return {
      orderId: null,
      errors: [
        invalidState(cart.status, 'PLACE_ORDER', 'Este carrito ya fue procesado; abre uno nuevo.'),
      ],
    };
  }

  const items = await cartWriteRepository.findItems(input.cartId);
  if (items.length === 0) {
    return { orderId: null, errors: [validation('cartId', 'El carrito está vacío.')] };
  }

  const prescription = await cartWriteRepository.findPrescription(input.cartId);

  const lines: OrderLine[] = items.map((item) => ({
    medicationId: String(item.medication_id),
    medicationName: item.name,
    quantity: item.quantity,
    requiresPrescription: item.requires_prescription,
    availableStock: item.stock,
    unitPrice: Number(item.price),
  }));

  // ---------------------------------------------------------------- invariantes
  const errors: CommandErrorShape[] = [];

  const prescriptionError = checkPrescription(
    lines,
    prescription
      ? {
          doctorName: prescription.doctor_name,
          medicalLicense: prescription.medical_license,
          issuedAt: String(prescription.issued_at),
          documentUrl: prescription.document_url,
        }
      : null,
  );
  if (prescriptionError) errors.push(prescriptionError);

  errors.push(...checkStock(lines));

  if (errors.length > 0) {
    logger.warn(
      { cartId: input.cartId, errors: errors.map((e) => e.code) },
      '[command] placeOrder rechazado por invariantes de negocio',
    );
    return { orderId: null, errors };
  }

  const total = calculateTotal(lines);
  const needsPrescription = requiresPrescription(lines);

  // ---------------------------------------------------------------- transacción
  try {
    const orderId = await sql.begin(async (tx) => {
      // Bloqueo en orden ascendente de id: dos compras simultáneas que compartan
      // medicamentos toman los locks en la misma secuencia y no pueden entrelazarse
      // en un deadlock.
      const ids = lines.map((line) => Number(line.medicationId)).sort((a, b) => a - b);
      await tx`
        select id from public.medications where id = any(${ids}) order by id for update
      `;

      // Descuento atómico. La condición `stock >= cantidad` vive DENTRO del UPDATE:
      // si otra transacción se llevó las últimas unidades mientras validábamos, esta
      // sentencia afecta 0 filas y el comando se cae con el error correcto.
      for (const line of lines) {
        const updated = await tx<{ stock: number }[]>`
          update public.medications
             set stock = stock - ${line.quantity}
           where id = ${Number(line.medicationId)}
             and stock >= ${line.quantity}
          returning stock
        `;
        if (updated.length === 0) {
          const [current] = await tx<{ stock: number }[]>`
            select stock from public.medications where id = ${Number(line.medicationId)}
          `;
          throw new DomainAbort([
            outOfStock(line.medicationId, line.medicationName, line.quantity, current?.stock ?? 0),
          ]);
        }
      }

      const [order] = await tx<{ id: string }[]>`
        insert into public.orders (patient_id, cart_id, status, total, idempotency_key)
        values (${cart.patient_id}, ${Number(input.cartId)}, 'PENDING_APPROVAL',
                ${total}, ${input.idempotencyKey})
        returning id::text
      `;

      for (const line of lines) {
        await tx`
          insert into public.order_items (order_id, medication_id, quantity, unit_price)
          values (${Number(order.id)}, ${Number(line.medicationId)}, ${line.quantity}, ${line.unitPrice})
        `;
        await tx`
          insert into public.stock_reservations (order_id, medication_id, quantity)
          values (${Number(order.id)}, ${Number(line.medicationId)}, ${line.quantity})
        `;
      }

      // La receta deja de pertenecer al borrador y pasa a respaldar la orden emitida.
      if (prescription) {
        await tx`
          update public.prescriptions
             set order_id = ${Number(order.id)}, cart_id = null
           where id = ${Number(prescription.id)}
        `;
      }

      await tx`update public.carts set status = 'CHECKED_OUT' where id = ${Number(input.cartId)}`;

      // Outbox: mismo commit que el cambio de estado. Este evento es lo que dispara
      // al projector y, con él, toda la consistencia eventual del Escenario C.
      await tx`
        insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
        values ('Order', ${order.id}, 'OrderPlaced', ${sql.json({
          patientId: cart.patient_id,
          total,
          requiresPrescription: needsPrescription,
          items: lines.map((line) => ({
            medicationId: line.medicationId,
            name: line.medicationName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.unitPrice * line.quantity,
          })),
        })})
      `;

      return order.id;
    });

    logger.info(
      { orderId, total, items: lines.length },
      '[command] placeOrder confirmado — inventario reservado y evento OrderPlaced en el outbox',
    );
    return { orderId, errors: [] };
  } catch (error) {
    if (error instanceof DomainAbort) {
      logger.warn(
        { cartId: input.cartId, errors: error.errors.map((e) => e.code) },
        '[command] placeOrder revertido — carrera de inventario detectada en la transacción',
      );
      return { orderId: null, errors: error.errors };
    }
    throw error;
  }
}

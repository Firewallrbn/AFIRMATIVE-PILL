import { listenerDb } from '@/server/shared/db';
import { logger } from '@/server/shared/logger';
import { toOrder, type OrderModel } from '@/server/query-side/models';
import { orderReadRepository } from '@/server/query-side/read-repositories/order-read-repository';

/**
 * ============================================================================
 *  SUBSCRIPTION: orderStatusChanged
 * ============================================================================
 *
 * Fuente del evento: `LISTEN order_changed` de Postgres. El trigger sobre
 * `order_projection` emite `NOTIFY` cada vez que el projector escribe la proyección,
 * así que lo que llega al cliente no es "el comando se ejecutó" sino algo más fuerte:
 * "el read model ya está consistente y puedes confiar en lo que vas a leer".
 *
 * Transporte hacia el navegador: SSE por el mismo endpoint `/graphql` (ver
 * `src/app/graphql/route.ts`). Sin WebSocket, sin segundo puerto, sin REST.
 */

/** Cola mínima para convertir el callback de NOTIFY en un async iterator. */
function createSignal() {
  let resolve: (() => void) | null = null;
  let pending = false;

  return {
    notify() {
      pending = true;
      resolve?.();
      resolve = null;
    },
    async wait() {
      if (pending) {
        pending = false;
        return;
      }
      await new Promise<void>((r) => {
        resolve = r;
      });
      pending = false;
    },
  };
}

export async function* orderStatusChanged(orderId: string): AsyncGenerator<OrderModel> {
  const signal = createSignal();
  const sql = listenerDb();

  const subscription = await sql.listen('order_changed', (payload) => {
    if (String(payload) === String(orderId)) signal.notify();
  });

  logger.info({ orderId }, '[subscription] cliente suscrito a orderStatusChanged');

  try {
    // Estado inicial: el cliente no debería esperar al primer cambio para ver algo.
    const first = await orderReadRepository.findById(orderId);
    if (first) yield toOrder(first);

    while (true) {
      await signal.wait();
      const row = await orderReadRepository.findById(orderId);
      if (row) {
        logger.info(
          { orderId, status: row.status, version: row.projection_version },
          '[subscription] proyección actualizada — empujando al cliente',
        );
        yield toOrder(row);
      }
    }
  } finally {
    await subscription.unlisten().catch(() => undefined);
    logger.info({ orderId }, '[subscription] cliente desconectado');
  }
}

export const subscriptionResolvers = {
  Subscription: {
    orderStatusChanged: {
      subscribe: (_: unknown, { orderId }: { orderId: string }) => orderStatusChanged(orderId),
      resolve: (payload: OrderModel) => payload,
    },
  },
};

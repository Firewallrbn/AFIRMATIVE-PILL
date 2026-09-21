'use client';

import Link from 'next/link';
import { useQuery } from '@apollo/client/react';
import { ORDERS } from '@/graphql/operations';
import { PATIENT_ID } from '@/lib/cart-context';
import { formatCOP, type OrderProjection, type OrderStatus } from '@/lib/types';

const STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING_APPROVAL: 'bg-brand-soft text-brand',
  APPROVED: 'bg-brand-soft text-brand',
  DISPATCHED: 'bg-ok-soft text-ok',
  CANCELLED: 'bg-danger-soft text-danger',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_APPROVAL: 'Pendiente de validación',
  APPROVED: 'Aprobado',
  DISPATCHED: 'Despachado',
  CANCELLED: 'Anulado',
};

/**
 * Historial del paciente.
 *
 * Se sirve íntegramente de `order_projection`: un SELECT por `patient_id` sobre una
 * tabla desnormalizada, sin tocar `orders` ni `order_items`. Ese es el rendimiento que
 * compra la segregación CQRS en el lado de lectura.
 */
export default function OrdersPage() {
  const { data, loading, error } = useQuery<{ orders: OrderProjection[] }>(ORDERS, {
    variables: { patientId: PATIENT_ID },
  });

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Mis pedidos</h1>
      <p className="mt-1.5 text-ink-soft">
        Seguimiento de cada orden emitida desde este dispositivo.
      </p>

      {loading ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-8 rounded-2xl border border-danger/25 bg-danger-soft p-5 text-danger">
          {error.message}
        </p>
      ) : null}

      {data && data.orders.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-line bg-surface p-12 text-center">
          <p className="font-semibold text-ink">Todavía no emitiste ningún pedido</p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Ir al catálogo
          </Link>
        </div>
      ) : null}

      <ul className="mt-8 space-y-3">
        {data?.orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/ordenes/${order.id}`}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand/40"
            >
              <div>
                <p className="font-semibold text-ink">Pedido #{order.id}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {new Date(order.placedAt).toLocaleString('es-CO')} · {order.items.length} ítem(s)
                  {order.freshness === 'SYNCING' ? (
                    <span className="animate-sync ml-2 font-medium text-brand">· sincronizando</span>
                  ) : null}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${STATUS_STYLE[order.status]}`}>
                  {STATUS_LABEL[order.status]}
                </span>
                <span className="text-lg font-bold tabular-nums text-ink">
                  {formatCOP(order.total)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useSubscription } from '@apollo/client/react';
import {
  APPROVE_ORDER,
  CANCEL_ORDER,
  DISPATCH_ORDER,
  ORDER,
  ORDER_STATUS_CHANGED,
} from '@/graphql/operations';
import { formatCOP, type CommandError, type OrderProjection, type OrderStatus } from '@/lib/types';
import { CommandErrors } from './ui';

/**
 * Escenario C — seguimiento del pedido con consistencia eventual y tiempo real.
 *
 * Dos fuentes que alimentan el MISMO objeto del caché:
 *
 *   · `useQuery(ORDER)`       — el estado al entrar a la pantalla.
 *   · `useSubscription(...)`  — cada cambio posterior, empujado por el servidor.
 *
 * No hay `refetch` ni polling. Como `OrderProjection` está normalizada por `id`, lo que
 * llega por la subscription reemplaza los campos en el caché y React vuelve a pintar.
 */

const STEPS: { status: OrderStatus; label: string; description: string }[] = [
  {
    status: 'PENDING_APPROVAL',
    label: 'En validación',
    description: 'Un químico farmacéutico revisa la fórmula y el inventario reservado.',
  },
  { status: 'APPROVED', label: 'Aprobado', description: 'Pedido autorizado para alistamiento.' },
  { status: 'DISPATCHED', label: 'Despachado', description: 'El pedido salió de bodega.' },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_APPROVAL: 'Pendiente de validación',
  APPROVED: 'Aprobado',
  DISPATCHED: 'Despachado',
  CANCELLED: 'Anulado',
};

export function OrderTracker({ orderId }: { orderId: string }) {
  const [errors, setErrors] = useState<CommandError[]>([]);

  const { data, loading, error } = useQuery<{ order: OrderProjection | null }>(ORDER, {
    variables: { id: orderId },
  });

  // El servidor empuja la proyección cada vez que el projector la actualiza. Apollo
  // escribe el resultado en el caché por sí solo: no hace falta tocar nada acá.
  useSubscription(ORDER_STATUS_CHANGED, { variables: { orderId } });

  const [approve, { loading: approving }] = useMutation(APPROVE_ORDER);
  const [dispatchOrder, { loading: dispatching }] = useMutation(DISPATCH_ORDER);
  const [cancel, { loading: cancelling }] = useMutation(CANCEL_ORDER);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16">
        <div className="h-64 animate-pulse rounded-3xl border border-line bg-surface" />
      </div>
    );
  }

  if (error || !data?.order) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-24 text-center">
        <h1 className="text-2xl font-bold text-ink">No encontramos este pedido</h1>
        <p className="mt-2 text-ink-soft">{error?.message}</p>
        <Link href="/ordenes" className="mt-5 inline-block font-semibold text-brand underline underline-offset-4">
          Ver mis pedidos
        </Link>
      </div>
    );
  }

  const order = data.order;
  const syncing = order.freshness === 'SYNCING';
  const cancelled = order.status === 'CANCELLED';
  const currentStep = STEPS.findIndex((step) => step.status === order.status);

  async function runCommand(
    run: () => Promise<{ data?: unknown }>,
    pick: (data: unknown) => { errors: CommandError[] } | undefined,
  ) {
    setErrors([]);
    const result = await run();
    const payload = pick(result.data);
    if (payload?.errors?.length) setErrors(payload.errors);
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/ordenes" className="hover:text-brand">
          Mis pedidos
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-soft">Pedido #{order.id}</span>
      </nav>

      {/* ---------------------------------------------- consistencia eventual visible */}
      {syncing ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-brand/25 bg-brand-soft px-5 py-4">
          <span className="animate-sync h-2.5 w-2.5 rounded-full bg-brand" aria-hidden="true" />
          <p className="text-sm text-ink">
            <strong className="font-semibold">Consolidando tu pedido…</strong> El comando ya
            se confirmó; estamos terminando de actualizar la vista de seguimiento.
          </p>
        </div>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-ink">Pedido #{order.id}</h1>
          <p className="mt-1 text-sm text-muted">
            Emitido el {new Date(order.placedAt).toLocaleString('es-CO')} · versión de
            proyección {order.version}
          </p>
        </div>
        <span
          className={`rounded-full px-4 py-2 text-sm font-bold ${
            cancelled
              ? 'bg-danger-soft text-danger'
              : order.status === 'DISPATCHED'
                ? 'bg-ok-soft text-ok'
                : 'bg-brand-soft text-brand'
          }`}
        >
          {STATUS_LABEL[order.status]}
        </span>
      </header>

      {/* ---------------------------------------------- línea de estado */}
      {!cancelled ? (
        <ol className="mt-9 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => {
            const done = index <= currentStep;
            return (
              <li
                key={step.status}
                className={`rounded-2xl border p-5 transition-colors ${
                  done ? 'border-brand/30 bg-brand-soft' : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      done ? 'bg-brand text-white' : 'bg-line text-muted'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <p className={`font-semibold ${done ? 'text-ink' : 'text-muted'}`}>
                    {step.label}
                  </p>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                  {step.description}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-8 rounded-2xl border border-danger/25 bg-danger-soft px-5 py-4 text-sm text-danger">
          <strong className="font-semibold">Pedido anulado.</strong>{' '}
          {order.cancellationReason ?? 'Sin motivo registrado.'} El inventario reservado
          volvió a bodega.
        </p>
      )}

      {/* ---------------------------------------------- detalle */}
      <section className="mt-10 overflow-hidden rounded-3xl border border-line bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Detalle del pedido</caption>
          <thead className="border-b border-line bg-canvas text-left text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-5 py-3 font-bold">Medicamento</th>
              <th className="px-5 py-3 text-center font-bold">Cant.</th>
              <th className="px-5 py-3 text-right font-bold">Unitario</th>
              <th className="px-5 py-3 text-right font-bold">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {order.items.map((item) => (
              <tr key={item.medicationId}>
                <td className="px-5 py-3.5">
                  <Link href={`/medicamentos/${item.medicationId}`} className="font-medium text-ink hover:text-brand">
                    {item.name}
                  </Link>
                </td>
                <td className="px-5 py-3.5 text-center tabular-nums text-ink-soft">
                  {item.quantity}
                </td>
                <td className="px-5 py-3.5 text-right tabular-nums text-ink-soft">
                  {formatCOP(item.unitPrice)}
                </td>
                <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink">
                  {formatCOP(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-canvas">
            <tr>
              <td colSpan={3} className="px-5 py-4 text-right font-semibold text-ink">
                Total
              </td>
              <td className="px-5 py-4 text-right text-lg font-bold tabular-nums text-ink">
                {formatCOP(order.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {order.requiresPrescription ? (
        <p className="mt-5 rounded-2xl border border-rx/20 bg-rx-soft px-5 py-4 text-sm text-rx">
          Fórmula médica:{' '}
          <strong className="font-bold">
            {order.prescriptionStatus === 'VALIDATED'
              ? 'verificada por el químico farmacéutico'
              : order.prescriptionStatus === 'REJECTED'
                ? 'rechazada'
                : 'pendiente de verificación'}
          </strong>
        </p>
      ) : null}

      {/* ---------------------------------------------- back-office (demo) */}
      <section className="mt-10 rounded-3xl border border-dashed border-line bg-surface p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
          Panel de operación · demostración
        </h2>
        <p className="mt-1.5 text-sm text-ink-soft">
          Estos comandos los ejecutaría el back-office farmacéutico. Al dispararlos, el
          estado de arriba se actualiza solo: viaja por la subscription, sin recargar.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={approving || order.status !== 'PENDING_APPROVAL'}
            onClick={() =>
              runCommand(
                () => approve({ variables: { orderId } }),
                (data) => (data as { approveOrder?: { errors: CommandError[] } })?.approveOrder,
              )
            }
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
          >
            Validar fórmula y aprobar
          </button>

          <button
            type="button"
            disabled={dispatching || order.status !== 'APPROVED'}
            onClick={() =>
              runCommand(
                () => dispatchOrder({ variables: { orderId } }),
                (data) => (data as { dispatchOrder?: { errors: CommandError[] } })?.dispatchOrder,
              )
            }
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand hover:text-brand disabled:opacity-40"
          >
            Despachar
          </button>

          <button
            type="button"
            disabled={cancelling || cancelled || order.status === 'DISPATCHED'}
            onClick={() =>
              runCommand(
                () =>
                  cancel({
                    variables: { orderId, reason: 'Anulado desde el panel de operación' },
                  }),
                (data) => (data as { cancelOrder?: { errors: CommandError[] } })?.cancelOrder,
              )
            }
            className="rounded-full border border-danger/30 px-5 py-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-40"
          >
            Anular y devolver inventario
          </button>
        </div>

        <div className="mt-5">
          <CommandErrors errors={errors} />
        </div>
      </section>
    </div>
  );
}

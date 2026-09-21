'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@apollo/client/react';
import {
  ATTACH_PRESCRIPTION,
  ORDERS,
  PLACE_ORDER,
  REMOVE_MEDICATION_FROM_CART,
} from '@/graphql/operations';
import { PATIENT_ID, useCart } from '@/lib/cart-context';
import { formatCOP, type CommandError, type OrderProjection } from '@/lib/types';
import { CommandErrors, RxBadge } from '@/components/ui';

/**
 * Escenario B — armado del pedido y control de prescripción.
 *
 * La pantalla es el reflejo de los comandos del dominio: quitar un ítem, adjuntar la
 * fórmula médica y emitir el pedido son tres intenciones distintas, con tres mutaciones
 * distintas. No hay un `saveCart` genérico que haga las tres cosas.
 */
export default function CartPage() {
  const router = useRouter();
  const { cartId, cart, loading, resetCart } = useCart();

  const [errors, setErrors] = useState<CommandError[]>([]);
  const [prescriptionSaved, setPrescriptionSaved] = useState(false);

  /**
   * Clave de idempotencia estable por intento de compra.
   *
   * Vive en un ref y no en estado: si el primer envío falla por red y el paciente vuelve
   * a tocar el botón, se reenvía la MISMA clave. El servidor reconoce el reintento y
   * devuelve la orden ya creada en lugar de dispensar dos veces el mismo medicamento.
   */
  const idempotencyKey = useRef<string>(
    typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now()),
  );

  const [removeMedication] = useMutation(REMOVE_MEDICATION_FROM_CART);
  const [attachPrescription, { loading: attaching }] = useMutation(ATTACH_PRESCRIPTION);

  const [placeOrder, { loading: placing }] = useMutation(PLACE_ORDER, {
    /**
     * Actualización inteligente del caché.
     *
     * En vez de refetchear el historial, se inserta la orden recién creada al principio
     * de la lista `orders(patientId)` que ya está en memoria. Cuando el paciente navegue
     * a "Mis pedidos", la orden ya está ahí — sin un viaje más a la red.
     */
    update(cache, result) {
      const order = (result.data as { placeOrder?: { order: OrderProjection | null } })
        ?.placeOrder?.order;
      if (!order) return;

      const existing = cache.readQuery<{ orders: OrderProjection[] }>({
        query: ORDERS,
        variables: { patientId: PATIENT_ID },
      });
      if (!existing) return;

      cache.writeQuery({
        query: ORDERS,
        variables: { patientId: PATIENT_ID },
        data: { orders: [order, ...existing.orders] },
      });
    },
  });

  if (loading) {
    return <Shell><p className="text-muted">Cargando carrito…</p></Shell>;
  }

  if (!cartId || !cart || cart.items.length === 0) {
    return (
      <Shell>
        <div className="rounded-3xl border border-line bg-surface p-12 text-center">
          <h1 className="text-2xl font-bold text-ink">Tu carrito está vacío</h1>
          <p className="mt-2 text-ink-soft">Explorá el catálogo y agregá lo que necesites.</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Ir al catálogo
          </Link>
        </div>
      </Shell>
    );
  }

  const needsPrescription = cart.requiresPrescription;
  const hasPrescription = Boolean(cart.prescription);
  const blocked = needsPrescription && !hasPrescription;

  async function handleAttach(formData: FormData) {
    setErrors([]);
    const result = await attachPrescription({
      variables: {
        input: {
          cartId,
          prescription: {
            doctorName: String(formData.get('doctorName') ?? ''),
            medicalLicense: String(formData.get('medicalLicense') ?? ''),
            issuedAt: String(formData.get('issuedAt') ?? ''),
            documentUrl: String(formData.get('documentUrl') ?? ''),
          },
        },
      },
    });

    const payload = (result.data as { attachPrescriptionToCart?: { errors: CommandError[] } })
      ?.attachPrescriptionToCart;
    if (payload?.errors?.length) {
      setErrors(payload.errors);
      return;
    }
    setPrescriptionSaved(true);
  }

  async function handlePlaceOrder() {
    setErrors([]);
    const result = await placeOrder({
      variables: { input: { cartId, idempotencyKey: idempotencyKey.current } },
    });

    const payload = (result.data as {
      placeOrder?: { order: OrderProjection | null; errors: CommandError[] };
    })?.placeOrder;

    if (payload?.errors?.length) {
      setErrors(payload.errors);
      return;
    }
    if (payload?.order) {
      resetCart();
      router.push(`/ordenes/${payload.order.id}`);
    }
  }

  return (
    <Shell>
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Tu pedido</h1>
      <p className="mt-1.5 text-ink-soft">
        Revisá las cantidades antes de confirmar. El inventario se reserva al emitir el pedido.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
            {cart.items.map((item) => (
              <li key={item.medication.id} className="flex items-start gap-4 p-5">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <RxBadge requiresPrescription={item.medication.requiresPrescription} />
                  </div>
                  <h2 className="mt-2 font-semibold text-ink">
                    <Link
                      href={`/medicamentos/${item.medication.id}`}
                      className="hover:text-brand"
                    >
                      {item.medication.name}
                    </Link>
                  </h2>
                  <p className="text-sm text-muted">
                    {item.medication.dosage} · {item.medication.presentation}
                  </p>
                  <p className="mt-1.5 text-sm text-ink-soft">
                    {item.quantity} × {formatCOP(item.unitPrice)}
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-bold tabular-nums text-ink">{formatCOP(item.lineTotal)}</p>
                  <button
                    type="button"
                    onClick={() =>
                      removeMedication({
                        variables: {
                          input: { cartId, medicationId: item.medication.id },
                        },
                      })
                    }
                    className="mt-2 text-xs font-semibold text-muted underline underline-offset-4 hover:text-danger"
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* ------------------------------------------------ fórmula médica */}
          {needsPrescription ? (
            <section className="rounded-3xl border border-rx/25 bg-rx-soft p-6">
              <h2 className="text-lg font-bold text-rx">Fórmula médica requerida</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                Tu pedido incluye medicamentos de venta bajo prescripción. Sin estos datos
                la orden no puede emitirse.
              </p>

              {hasPrescription ? (
                <div className="mt-5 rounded-2xl border border-line bg-surface p-5">
                  <p className="text-sm font-semibold text-ok">
                    ✓ Fórmula adjunta — pendiente de verificación farmacéutica
                  </p>
                  <dl className="mt-3 space-y-1 text-sm text-ink-soft">
                    <div>
                      <dt className="inline font-medium text-ink">Profesional: </dt>
                      <dd className="inline">{cart.prescription?.doctorName}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-ink">Registro: </dt>
                      <dd className="inline">{cart.prescription?.medicalLicense}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-ink">Expedida: </dt>
                      <dd className="inline">{cart.prescription?.issuedAt}</dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <form
                  action={handleAttach}
                  className="mt-5 grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2"
                >
                  <Field name="doctorName" label="Médico que la expidió" placeholder="Dra. Ana Restrepo" />
                  <Field name="medicalLicense" label="Registro profesional" placeholder="RM-48213" />
                  <Field name="issuedAt" label="Fecha de expedición" type="date" />
                  <Field
                    name="documentUrl"
                    label="Soporte digital (URL)"
                    type="url"
                    placeholder="https://…/formula.pdf"
                  />
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={attaching}
                      className="rounded-full bg-rx px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {attaching ? 'Adjuntando…' : 'Adjuntar fórmula médica'}
                    </button>
                    {prescriptionSaved ? (
                      <span className="ml-3 text-sm text-ok">Guardada</span>
                    ) : null}
                  </div>
                </form>
              )}
            </section>
          ) : null}
        </div>

        {/* ------------------------------------------------ resumen */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-line bg-surface p-6">
            <h2 className="text-lg font-bold text-ink">Resumen</h2>

            <dl className="mt-5 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Ítems</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {cart.items.reduce((total, item) => total + item.quantity, 0)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-3">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="text-xl font-bold tabular-nums text-ink">
                  {formatCOP(cart.subtotal)}
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={placing || blocked}
              className="mt-6 w-full rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45"
            >
              {placing ? 'Emitiendo pedido…' : 'Confirmar pedido'}
            </button>

            {blocked ? (
              <p className="mt-3 text-center text-[13px] text-rx">
                Adjuntá la fórmula médica para habilitar la compra.
              </p>
            ) : null}

            <div className="mt-5">
              <CommandErrors errors={errors} />
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-5 py-12">{children}</div>;
}

function Field({
  name,
  label,
  type = 'text',
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink">{label}</span>
      <input
        required
        name={name}
        type={type}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted"
      />
    </label>
  );
}

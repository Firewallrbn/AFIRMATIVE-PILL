'use client';

import Link from 'next/link';
import { useQuery } from '@apollo/client/react';
import { MEDICATION_DETAIL } from '@/graphql/operations';
import { formatCOP, type MedicationDetail as Detail } from '@/lib/types';
import { AddToCartButton } from './add-to-cart-button';
import { MedicationCard } from './medication-card';
import { RxBadge, StockBadge } from './ui';

/**
 * Escenario A — ficha técnica.
 *
 * Esta query sí pide los campos anidados: `activeIngredient`, `laboratory`, `category` y
 * `relatedMedications`. Del lado del servidor, esos cuatro resolvers son los que
 * justifican los DataLoaders; del lado del cliente, es la prueba de que el listado y la
 * ficha comparten tipo pero no costo.
 */
export function MedicationDetailView({ id }: { id: string }) {
  const { data, loading, error } = useQuery<{ medication: Detail | null }>(MEDICATION_DETAIL, {
    variables: { id },
  });

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16">
        <div className="h-72 animate-pulse rounded-3xl border border-line bg-surface" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16">
        <p className="rounded-2xl border border-danger/25 bg-danger-soft p-5 text-danger">
          No pudimos cargar la ficha: {error.message}
        </p>
      </div>
    );
  }

  const medication = data?.medication;
  if (!medication) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-24 text-center">
        <h1 className="text-2xl font-bold text-ink">Medicamento no encontrado</h1>
        <Link href="/" className="mt-4 inline-block font-semibold text-brand underline underline-offset-4">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  const facts = [
    { label: 'Principio activo', value: medication.activeIngredient.name },
    { label: 'Concentración', value: medication.dosage },
    { label: 'Presentación', value: medication.presentation },
    { label: 'Laboratorio', value: medication.laboratory.name },
    { label: 'Categoría terapéutica', value: medication.category.name },
    { label: 'Código interno', value: medication.sku },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <nav className="mb-8 text-sm text-muted">
        <Link href="/" className="hover:text-brand">
          Catálogo
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-soft">{medication.category.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <article>
          <div className="flex flex-wrap items-center gap-2">
            <RxBadge requiresPrescription={medication.requiresPrescription} />
            <span className="text-sm text-muted">{medication.activeIngredient.name}</span>
          </div>

          <h1 className="mt-4 text-[38px] font-bold leading-tight tracking-tight text-ink">
            {medication.name}
          </h1>
          <p className="mt-2 text-[17px] text-ink-soft">
            {medication.dosage} · {medication.presentation}
          </p>

          <p className="mt-7 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            {medication.description}
          </p>

          <dl className="mt-9 grid gap-x-8 gap-y-5 border-t border-line pt-7 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[12px] font-bold uppercase tracking-wide text-muted">
                  {fact.label}
                </dt>
                <dd className="mt-1 text-[15px] font-medium text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {medication.requiresPrescription ? (
            <p className="mt-8 rounded-2xl border border-rx/20 bg-rx-soft px-5 py-4 text-sm leading-relaxed text-rx">
              <strong className="font-bold">Requiere fórmula médica.</strong> Vas a poder
              agregarlo al carrito, pero el pedido no se emite hasta que adjuntes la
              prescripción con el registro del profesional que la expidió.
            </p>
          ) : null}
        </article>

        {/* Panel de compra: se queda a la vista mientras se lee la ficha. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-line bg-surface p-6">
            <p className="text-[34px] font-bold tabular-nums leading-none text-ink">
              {formatCOP(medication.price)}
            </p>
            <div className="mt-3">
              <StockBadge inStock={medication.inStock} stock={medication.stock} />
            </div>

            <div className="mt-6">
              <AddToCartButton medicationId={medication.id} disabled={!medication.inStock} />
            </div>

            <p className="mt-5 border-t border-line pt-5 text-[13px] leading-relaxed text-muted">
              El inventario se reserva de forma atómica al confirmar el pedido. Si otra
              persona se lleva la última unidad mientras compras, te lo decimos en ese
              momento en lugar de aceptarte una orden que no podemos despachar.
            </p>
          </div>
        </aside>
      </div>

      {medication.relatedMedications.length > 0 ? (
        <section className="mt-16">
          <h2 className="text-xl font-bold tracking-tight text-ink">
            Otras opciones en {medication.category.name}
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {medication.relatedMedications.map((related) => (
              <MedicationCard key={related.id} medication={related} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

import Link from 'next/link';
import { formatCOP, type MedicationSummary } from '@/lib/types';
import { AddToCartButton } from './add-to-cart-button';
import { RxBadge } from './ui';

/**
 * Tarjeta del catálogo.
 *
 * Consume `MedicationSummary` y solo eso: nombre, dosis, presentación, precio, si exige
 * fórmula y si hay stock. La descripción clínica, el laboratorio y el principio activo
 * NO se piden acá — viven en la ficha. Es la evidencia visible del anti over-fetching:
 * pintar 50 tarjetas no descarga 50 fichas técnicas.
 */
export function MedicationCard({ medication }: { medication: MedicationSummary }) {
  return (
    <article className="group flex flex-col justify-between gap-4 rounded-2xl border border-line bg-surface p-5 transition-all hover:border-brand/40 hover:shadow-[0_8px_28px_-18px_rgba(11,27,43,0.45)]">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <RxBadge requiresPrescription={medication.requiresPrescription} />
          <span className="font-mono text-[11px] text-muted">{medication.sku}</span>
        </div>

        <div>
          <h3 className="text-[17px] font-semibold leading-tight text-ink">
            <Link
              href={`/medicamentos/${medication.id}`}
              className="transition-colors group-hover:text-brand"
            >
              {medication.name}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-muted">
            {medication.dosage} · {medication.presentation}
          </p>
          {/* Campo resuelto por DataLoader: 20 tarjetas = 20 claves = 1 consulta. */}
          <p className="mt-2 text-[12px] font-medium uppercase tracking-wide text-brand">
            {medication.category.name}
          </p>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="text-xl font-bold tabular-nums text-ink">{formatCOP(medication.price)}</p>
          {!medication.inStock ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-danger">Agotado</p>
          ) : null}
        </div>
        <AddToCartButton
          medicationId={medication.id}
          disabled={!medication.inStock}
          variant="outline"
        />
      </div>
    </article>
  );
}

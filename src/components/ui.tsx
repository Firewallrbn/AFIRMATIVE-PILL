import Link from 'next/link';
import type { CommandError } from '@/lib/types';

/**
 * Piezas visuales compartidas. Deliberadamente pocas y sin librería de componentes:
 * el proyecto se evalúa por su arquitectura de datos, no por su design system.
 */

/**
 * Distintivo de fórmula médica.
 *
 * El elemento más importante de toda la interfaz: es la diferencia entre un producto que
 * el paciente puede comprar y uno que legalmente exige prescripción. Color reservado,
 * texto explícito y nunca solo color — un daltónico tiene que poder distinguirlo igual.
 */
export function RxBadge({ requiresPrescription }: { requiresPrescription: boolean }) {
  if (requiresPrescription) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rx-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rx">
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 1h4a2.5 2.5 0 0 1 0 5H2V1Zm0 5 5 5M2 1v10" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
        Fórmula médica
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ok">
      Venta libre
    </span>
  );
}

export function StockBadge({ inStock, stock }: { inStock: boolean; stock?: number }) {
  if (!inStock) {
    return (
      <span className="inline-flex items-center rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-danger">
        Agotado
      </span>
    );
  }
  return (
    <span className="text-[13px] font-medium text-muted">
      {typeof stock === 'number' ? `${stock} unidades disponibles` : 'Disponible'}
    </span>
  );
}

/**
 * Errores de comando.
 *
 * Se renderizan desde `payload.errors`, no desde el `error` de Apollo: son resultados
 * legítimos del dominio (stock insuficiente, receta faltante) y no fallos de red. Cada
 * tipo aporta datos propios, y acá se aprovechan en vez de mostrar solo el mensaje.
 */
export function CommandErrors({ errors }: { errors: CommandError[] }) {
  if (!errors?.length) return null;

  return (
    <ul className="space-y-2" role="alert">
      {errors.map((error, index) => (
        <li
          key={`${error.code}-${index}`}
          className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm"
        >
          <p className="font-semibold text-danger">{error.message}</p>

          {error.__typename === 'OutOfStockError' && typeof error.available === 'number' ? (
            <p className="mt-1 text-ink-soft">
              Solicitaste {error.requested} y quedan {error.available}.
            </p>
          ) : null}

          {error.__typename === 'PrescriptionRequiredError' && error.medications?.length ? (
            <ul className="mt-1.5 space-y-1 text-ink-soft">
              {error.medications.map((medication) => (
                <li key={medication.id}>
                  ·{' '}
                  <Link className="underline underline-offset-2" href={`/medicamentos/${medication.id}`}>
                    {medication.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {error.__typename === 'ValidationError' && error.field ? (
            <p className="mt-1 font-mono text-xs text-ink-soft">campo: {error.field}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Esqueleto de carga. Mantiene la altura de la grilla para que no salte el layout. */
export function CardSkeleton() {
  return (
    <div className="h-[186px] animate-pulse rounded-2xl border border-line bg-surface" />
  );
}

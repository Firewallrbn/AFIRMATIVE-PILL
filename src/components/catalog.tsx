'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { CATALOG_MEDICATIONS } from '@/graphql/operations';
import type { MedicationConnection } from '@/lib/types';
import { MedicationCard } from './medication-card';
import { CardSkeleton } from './ui';

/**
 * Escenario A — exploración eficiente del catálogo.
 *
 * Una sola `useQuery` alimenta la grilla, el contador de resultados y las facetas del
 * panel lateral. Las facetas se calculan en el servidor con el MISMO filtro, así que los
 * números del sidebar nunca contradicen lo que se ve en la grilla.
 */

type Sort = { field: 'RELEVANCE' | 'NAME' | 'PRICE'; direction: 'ASC' | 'DESC' };

const SORTS: { label: string; value: Sort }[] = [
  { label: 'Más relevantes', value: { field: 'RELEVANCE', direction: 'ASC' } },
  { label: 'Precio: menor a mayor', value: { field: 'PRICE', direction: 'ASC' } },
  { label: 'Precio: mayor a menor', value: { field: 'PRICE', direction: 'DESC' } },
  { label: 'Nombre (A–Z)', value: { field: 'NAME', direction: 'ASC' } },
];

const PAGE_SIZE = 12;

export function Catalog() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [prescription, setPrescription] = useState<boolean | null>(null);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [sortIndex, setSortIndex] = useState(0);

  // Debounce: escribir "amoxicilina" no puede significar once consultas al servidor.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filter = useMemo(
    () => ({
      search: search || null,
      categoryIds: categoryIds.length ? categoryIds : null,
      requiresPrescription: prescription,
      onlyInStock: onlyInStock || null,
    }),
    [search, categoryIds, prescription, onlyInStock],
  );

  const { data, loading, error, fetchMore } = useQuery<{ medications: MedicationConnection }>(
    CATALOG_MEDICATIONS,
    {
      variables: { filter, sort: SORTS[sortIndex].value, first: PAGE_SIZE },
      notifyOnNetworkStatusChange: true,
    },
  );

  const connection = data?.medications;
  const facets = connection?.facets;

  function toggleCategory(id: string) {
    setCategoryIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  const hasFilters =
    Boolean(search) || categoryIds.length > 0 || prescription !== null || onlyInStock;

  return (
    <section id="catalogo" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-14">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
            Catálogo
          </p>
          <h2 className="mt-2 text-[32px] font-bold leading-tight tracking-tight text-ink">
            Encuentra tu medicamento
          </h2>
          <p className="mt-1.5 max-w-xl text-[15px] text-ink-soft">
            Busca por nombre comercial, principio activo o categoría terapéutica.
          </p>
        </div>

        <label className="text-sm text-ink-soft">
          <span className="sr-only">Ordenar por</span>
          <select
            value={sortIndex}
            onChange={(event) => setSortIndex(Number(event.target.value))}
            className="rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink"
          >
            {SORTS.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* ------------------------------------------------------------ facetas */}
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div>
            <label htmlFor="buscar" className="sr-only">
              Buscar medicamento
            </label>
            <input
              id="buscar"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Ibuprofeno, antibiótico…"
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-muted"
            />
          </div>

          <fieldset className="rounded-2xl border border-line bg-surface p-4">
            <legend className="px-1 text-[13px] font-bold uppercase tracking-wide text-ink-soft">
              Prescripción
            </legend>
            <div className="mt-2 space-y-1.5">
              {[
                { label: 'Todos', value: null },
                {
                  label: 'Venta libre',
                  value: false,
                  count: facets?.requiresPrescription.overTheCounter,
                },
                {
                  label: 'Con fórmula médica',
                  value: true,
                  count: facets?.requiresPrescription.withPrescription,
                },
              ].map((option) => (
                <label
                  key={String(option.value)}
                  className="flex cursor-pointer items-center justify-between gap-2 text-sm text-ink"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="prescription"
                      checked={prescription === option.value}
                      onChange={() => setPrescription(option.value)}
                      className="accent-brand"
                    />
                    {option.label}
                  </span>
                  {typeof option.count === 'number' ? (
                    <span className="tabular-nums text-xs text-muted">{option.count}</span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-line bg-surface p-4">
            <legend className="px-1 text-[13px] font-bold uppercase tracking-wide text-ink-soft">
              Categoría terapéutica
            </legend>
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {facets?.categories.map(({ category, count }) => (
                <label
                  key={category.id}
                  className="flex cursor-pointer items-center justify-between gap-2 text-sm text-ink"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(category.id)}
                      onChange={() => toggleCategory(category.id)}
                      className="accent-brand"
                    />
                    {category.name}
                  </span>
                  <span className="tabular-nums text-xs text-muted">{count}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={onlyInStock}
              onChange={(event) => setOnlyInStock(event.target.checked)}
              className="accent-brand"
            />
            Solo disponibles
          </label>

          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setCategoryIds([]);
                setPrescription(null);
                setOnlyInStock(false);
              }}
              className="text-sm font-semibold text-brand underline underline-offset-4"
            >
              Limpiar filtros
            </button>
          ) : null}
        </aside>

        {/* ------------------------------------------------------------ resultados */}
        <div>
          <p className="mb-4 text-sm text-muted" aria-live="polite">
            {loading && !connection
              ? 'Buscando…'
              : `${connection?.totalCount ?? 0} medicamento(s) encontrados`}
          </p>

          {error ? (
            <div className="rounded-2xl border border-danger/25 bg-danger-soft p-5 text-sm text-danger">
              No pudimos cargar el catálogo: {error.message}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading && !connection
              ? Array.from({ length: 6 }).map((_, index) => <CardSkeleton key={index} />)
              : connection?.edges.map(({ node }) => (
                  <MedicationCard key={node.id} medication={node} />
                ))}
          </div>

          {connection && connection.edges.length === 0 && !loading ? (
            <div className="rounded-2xl border border-line bg-surface p-10 text-center">
              <p className="font-semibold text-ink">Sin resultados</p>
              <p className="mt-1 text-sm text-muted">
                Prueba con el principio activo, por ejemplo &ldquo;paracetamol&rdquo;.
              </p>
            </div>
          ) : null}

          {connection?.pageInfo.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  fetchMore({ variables: { after: connection.pageInfo.endCursor } })
                }
                className="rounded-full border border-line bg-surface px-6 py-3 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
              >
                {loading ? 'Cargando…' : 'Ver más medicamentos'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

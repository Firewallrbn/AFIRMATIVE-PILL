import DataLoader from 'dataloader';
import { currentScope } from '@/server/shared/db';
import { logger } from '@/server/shared/logger';
import {
  catalogReadRepository,
  type CatalogRow,
} from '@/server/query-side/read-repositories/catalog-read-repository';
import {
  referenceReadRepository,
  type ActiveIngredientRow,
  type CategoryRow,
  type LaboratoryRow,
} from '@/server/query-side/read-repositories/reference-read-repository';
import {
  orderReadRepository,
  type OrderProjectionRow,
} from '@/server/query-side/read-repositories/order-read-repository';

/**
 * ============================================================================
 *  DataLoaders — mitigación del problema N+1
 * ============================================================================
 *
 * El problema: una query como
 *
 *     medications(first: 20) {
 *       edges { node { id name } }
 *     }
 *     medication(id: 3) { activeIngredient { name } laboratory { name } category { name } }
 *
 * hace que GraphQL ejecute el resolver de `activeIngredient`, `laboratory` y `category`
 * UNA VEZ POR MEDICAMENTO. Con 20 medicamentos son 1 + 20 + 20 + 20 = 61 consultas.
 *
 * La solución: cada uno de esos resolvers no consulta la base — pide una clave a un
 * DataLoader. DataLoader acumula todas las claves pedidas dentro del mismo tick del event
 * loop y ejecuta UNA consulta `where id = any($1)` por tipo de entidad. 61 -> 4.
 *
 * Dos propiedades que hay que respetar y que son fáciles de romper:
 *
 *   1. Los loaders se crean POR REQUEST (en context.ts), nunca a nivel de módulo. Un
 *      loader global cachearía el stock de un medicamento entre pacientes distintos y
 *      terminaríamos vendiendo inventario que ya no existe.
 *   2. La función de lote debe devolver un arreglo del MISMO tamaño y EN EL MISMO ORDEN
 *      que las claves recibidas. Por eso todo pasa por `indexBy`/`groupBy` y no se
 *      devuelve directo lo que vino de Postgres.
 */

/** Envuelve la función de lote para dejar rastro en el log de cada agrupación. */
function batchLoader<K, V, C = K>(
  name: string,
  batchFn: (keys: readonly K[]) => Promise<V[]>,
  options?: DataLoader.Options<K, V, C>,
): DataLoader<K, V, C> {
  return new DataLoader<K, V, C>(async (keys) => {
    const startedAt = Date.now();
    const values = await batchFn(keys);
    const scope = currentScope();

    logger.info(
      {
        requestId: scope?.requestId,
        loader: name,
        keys: keys.length,
        sqlQueries: 1,
        ms: Date.now() - startedAt,
      },
      `[dataloader] ${name}: ${keys.length} clave(s) agrupada(s) en 1 consulta SQL`,
    );

    return values;
  }, options);
}

function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(key(row), row);
  return map;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export type RelatedKey = { categoryId: string; excludeMedicationId: string; limit: number };

export function createLoaders() {
  return {
    /** Ficha de catálogo por id. La usan `Query.medication` y los ítems de una orden. */
    medicationById: batchLoader<string, CatalogRow | null>('medicationById', async (ids) => {
      const rows = await catalogReadRepository.findManyByIds(ids);
      const byId = indexBy(rows, (r) => String(r.medication_id));
      return ids.map((id) => byId.get(String(id)) ?? null);
    }),

    categoryById: batchLoader<string, CategoryRow | null>('categoryById', async (ids) => {
      const rows = await referenceReadRepository.findCategoriesByIds(ids);
      const byId = indexBy(rows, (r) => String(r.id));
      return ids.map((id) => byId.get(String(id)) ?? null);
    }),

    laboratoryById: batchLoader<string, LaboratoryRow | null>('laboratoryById', async (ids) => {
      const rows = await referenceReadRepository.findLaboratoriesByIds(ids);
      const byId = indexBy(rows, (r) => String(r.id));
      return ids.map((id) => byId.get(String(id)) ?? null);
    }),

    activeIngredientById: batchLoader<string, ActiveIngredientRow | null>(
      'activeIngredientById',
      async (ids) => {
        const rows = await referenceReadRepository.findActiveIngredientsByIds(ids);
        const byId = indexBy(rows, (r) => String(r.id));
        return ids.map((id) => byId.get(String(id)) ?? null);
      },
    ),

    /** `Category.medicationCount` para las facetas del sidebar. */
    medicationCountByCategoryId: batchLoader<string, number>(
      'medicationCountByCategoryId',
      async (ids) => {
        const rows = await referenceReadRepository.countMedicationsByCategoryIds(ids);
        const byId = indexBy(rows, (r) => String(r.category_id));
        return ids.map((id) => byId.get(String(id))?.count ?? 0);
      },
    ),

    /**
     * `Medication.relatedMedications`. La clave es un objeto, así que hay que darle a
     * DataLoader una `cacheKeyFn` estable: sin ella, dos claves equivalentes serían
     * objetos distintos y el caché por request no serviría de nada.
     */
    relatedMedications: batchLoader<RelatedKey, CatalogRow[], string>(
      'relatedMedications',
      async (keys) => {
        const rows = await catalogReadRepository.findRelatedByCategoryIds(keys);
        const byCategory = groupBy(rows, (r) => String(r.category_id));
        return keys.map((key) =>
          (byCategory.get(String(key.categoryId)) ?? [])
            .filter((row) => String(row.medication_id) !== String(key.excludeMedicationId))
            .slice(0, key.limit),
        );
      },
      {
        cacheKeyFn: (key) => `${key.categoryId}:${key.excludeMedicationId}:${key.limit}`,
      },
    ),

    /** `Laboratory.medications`. */
    medicationsByLaboratoryId: batchLoader<string, CatalogRow[]>(
      'medicationsByLaboratoryId',
      async (ids) => {
        const rows = await catalogReadRepository.findByLaboratoryIds(ids, 10);
        const byLab = groupBy(rows, (r) => String(r.laboratory_id));
        return ids.map((id) => byLab.get(String(id)) ?? []);
      },
    ),

    orderById: batchLoader<string, OrderProjectionRow | null>('orderById', async (ids) => {
      const rows = await orderReadRepository.findManyByIds(ids);
      const byId = indexBy(rows, (r) => String(r.order_id));
      return ids.map((id) => byId.get(String(id)) ?? null);
    }),

    /**
     * ¿La proyección de esta orden está al día? Resuelve el campo `freshness` para todas
     * las órdenes de la respuesta con una sola consulta al outbox.
     */
    orderHasPendingEvents: batchLoader<string, boolean>('orderHasPendingEvents', async (ids) => {
      const pending = await orderReadRepository.hasPendingEvents(ids);
      return ids.map((id) => pending.has(String(id)));
    }),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;

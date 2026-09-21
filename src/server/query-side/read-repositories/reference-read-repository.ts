import { db } from '@/server/shared/db';

/**
 * Repositorio de LECTURA de datos de referencia: categorías terapéuticas, laboratorios y
 * principios activos.
 *
 * Son tablas compartidas entre ambos lados del CQRS pero de una sola dirección: ningún
 * comando del dominio las modifica (se cargan con el dataset y no cambian durante la
 * operación). Por eso el read side puede leerlas directamente sin romper la segregación.
 *
 * Cada método de este archivo recibe una LISTA de ids: están escritos para DataLoader.
 */

export type CategoryRow = { id: string; name: string; slug: string };
export type LaboratoryRow = { id: string; name: string };
export type ActiveIngredientRow = { id: string; name: string };

export const referenceReadRepository = {
  async findCategoriesByIds(ids: readonly string[]): Promise<CategoryRow[]> {
    const sql = db();
    return sql<CategoryRow[]>`
      select id::text, name, slug
      from public.categories
      where id = any(${ids.map(Number)})
    `;
  },

  async findLaboratoriesByIds(ids: readonly string[]): Promise<LaboratoryRow[]> {
    const sql = db();
    return sql<LaboratoryRow[]>`
      select id::text, name
      from public.laboratories
      where id = any(${ids.map(Number)})
    `;
  },

  async findActiveIngredientsByIds(ids: readonly string[]): Promise<ActiveIngredientRow[]> {
    const sql = db();
    return sql<ActiveIngredientRow[]>`
      select id::text, name
      from public.active_ingredients
      where id = any(${ids.map(Number)})
    `;
  },

  /** Conteo de medicamentos por categoría, en lote: alimenta `Category.medicationCount`. */
  async countMedicationsByCategoryIds(
    ids: readonly string[],
  ): Promise<{ category_id: string; count: number }[]> {
    const sql = db();
    return sql<{ category_id: string; count: number }[]>`
      select category_id::text, count(*)::int as count
      from public.medication_catalog_projection
      where category_id = any(${ids.map(Number)})
      group by category_id
    `;
  },

  async allCategories(): Promise<CategoryRow[]> {
    const sql = db();
    return sql<CategoryRow[]>`
      select id::text, name, slug
      from public.categories
      order by name asc
    `;
  },

  async allLaboratories(): Promise<LaboratoryRow[]> {
    const sql = db();
    return sql<LaboratoryRow[]>`
      select id::text, name
      from public.laboratories
      order by name asc
    `;
  },
};

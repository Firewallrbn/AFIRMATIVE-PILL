import { db, type Sql } from '@/server/shared/db';

/**
 * Repositorio de LECTURA del catálogo.
 *
 * Regla del read side, sin excepciones: aquí solo hay SELECT y solo contra
 * `medication_catalog_projection` y las tablas de referencia. Si alguna vez aparece un
 * INSERT/UPDATE en este archivo, la segregación CQRS se rompió.
 */

export type CatalogRow = {
  medication_id: string;
  sku: string;
  name: string;
  active_ingredient: string;
  active_ingredient_id: string;
  category: string;
  category_id: string;
  category_slug: string;
  laboratory: string;
  laboratory_id: string;
  dosage: string;
  presentation: string;
  price: string;
  stock: number;
  in_stock: boolean;
  requires_prescription: boolean;
  description: string;
};

export type MedicationFilterInput = {
  search?: string | null;
  categoryIds?: string[] | null;
  categorySlugs?: string[] | null;
  activeIngredientIds?: string[] | null;
  laboratoryIds?: string[] | null;
  requiresPrescription?: boolean | null;
  onlyInStock?: boolean | null;
  minPrice?: number | null;
  maxPrice?: number | null;
};

export type MedicationSortInput = {
  field: 'RELEVANCE' | 'NAME' | 'PRICE';
  direction: 'ASC' | 'DESC';
};

/**
 * Construye el WHERE como fragmentos parametrizados de postgres.js.
 * Nunca se concatena texto del usuario: cada valor viaja como parámetro `$n`.
 */
function whereClause(sql: Sql, filter: MedicationFilterInput = {}) {
  const parts = [];

  if (filter.search?.trim()) {
    // El GIN sobre search_vector resuelve el término; plainto_tsquery se encarga de
    // normalizar acentos y raíces con el diccionario español.
    parts.push(sql`search_vector @@ plainto_tsquery('spanish', ${filter.search.trim()})`);
  }
  if (filter.categoryIds?.length) {
    parts.push(sql`category_id = any(${filter.categoryIds.map(Number)})`);
  }
  if (filter.categorySlugs?.length) {
    parts.push(sql`category_slug = any(${filter.categorySlugs})`);
  }
  if (filter.activeIngredientIds?.length) {
    parts.push(sql`active_ingredient_id = any(${filter.activeIngredientIds.map(Number)})`);
  }
  if (filter.laboratoryIds?.length) {
    parts.push(sql`laboratory_id = any(${filter.laboratoryIds.map(Number)})`);
  }
  if (typeof filter.requiresPrescription === 'boolean') {
    parts.push(sql`requires_prescription = ${filter.requiresPrescription}`);
  }
  if (filter.onlyInStock) {
    parts.push(sql`in_stock`);
  }
  if (typeof filter.minPrice === 'number') {
    parts.push(sql`price >= ${filter.minPrice}`);
  }
  if (typeof filter.maxPrice === 'number') {
    parts.push(sql`price <= ${filter.maxPrice}`);
  }

  if (parts.length === 0) return sql``;
  return parts.reduce((acc, part, i) => (i === 0 ? sql`where ${part}` : sql`${acc} and ${part}`), sql``);
}

function orderClause(sql: Sql, sort: MedicationSortInput, hasSearch: boolean) {
  const asc = sort.direction === 'ASC';

  if (sort.field === 'PRICE') {
    return asc
      ? sql`order by price asc, medication_id asc`
      : sql`order by price desc, medication_id asc`;
  }
  if (sort.field === 'NAME') {
    return asc ? sql`order by name asc, medication_id asc` : sql`order by name desc, medication_id asc`;
  }
  // RELEVANCE sin término de búsqueda no significa nada: caemos a un orden estable.
  if (!hasSearch) return sql`order by name asc, medication_id asc`;
  return sql`order by rank desc, medication_id asc`;
}

export const catalogReadRepository = {
  async search(
    filter: MedicationFilterInput,
    sort: MedicationSortInput,
    limit: number,
    offset: number,
  ): Promise<CatalogRow[]> {
    const sql = db();
    const hasSearch = Boolean(filter.search?.trim());
    const rank = hasSearch
      ? sql`, ts_rank(search_vector, plainto_tsquery('spanish', ${filter.search!.trim()})) as rank`
      : sql``;

    return sql<CatalogRow[]>`
      select medication_id, sku, name, active_ingredient, active_ingredient_id,
             category, category_id, category_slug, laboratory, laboratory_id,
             dosage, presentation, price, stock, in_stock, requires_prescription, description
             ${rank}
      from public.medication_catalog_projection
      ${whereClause(sql, filter)}
      ${orderClause(sql, sort, hasSearch)}
      limit ${limit} offset ${offset}
    `;
  },

  async count(filter: MedicationFilterInput): Promise<number> {
    const sql = db();
    const [row] = await sql<{ total: string }[]>`
      select count(*)::text as total
      from public.medication_catalog_projection
      ${whereClause(sql, filter)}
    `;
    return Number(row?.total ?? 0);
  },

  /** Facetas calculadas sobre el MISMO filtro, para los contadores del sidebar. */
  async categoryFacets(filter: MedicationFilterInput): Promise<{ category_id: string; count: number }[]> {
    const sql = db();
    return sql<{ category_id: string; count: number }[]>`
      select category_id, count(*)::int as count
      from public.medication_catalog_projection
      ${whereClause(sql, filter)}
      group by category_id
      order by count desc
    `;
  },

  async prescriptionFacet(
    filter: MedicationFilterInput,
  ): Promise<{ with_prescription: number; over_the_counter: number }> {
    const sql = db();
    const [row] = await sql<{ with_prescription: number; over_the_counter: number }[]>`
      select
        count(*) filter (where requires_prescription)::int     as with_prescription,
        count(*) filter (where not requires_prescription)::int as over_the_counter
      from public.medication_catalog_projection
      ${whereClause(sql, filter)}
    `;
    return row ?? { with_prescription: 0, over_the_counter: 0 };
  },

  /**
   * Carga en LOTE por id. Es la función que usa el DataLoader: una sola consulta con
   * `= any($1)` en lugar de N consultas `= $1`.
   */
  async findManyByIds(ids: readonly string[]): Promise<CatalogRow[]> {
    const sql = db();
    return sql<CatalogRow[]>`
      select medication_id, sku, name, active_ingredient, active_ingredient_id,
             category, category_id, category_slug, laboratory, laboratory_id,
             dosage, presentation, price, stock, in_stock, requires_prescription, description
      from public.medication_catalog_projection
      where medication_id = any(${ids.map(Number)})
    `;
  },

  /**
   * Alternativas por categoría, también en lote.
   * `row_number()` particionado evita traer el catálogo entero para quedarse con 4 por
   * categoría: el recorte ocurre en el motor, no en Node.
   */
  async findRelatedByCategoryIds(
    pairs: readonly { categoryId: string; excludeMedicationId: string; limit: number }[],
  ): Promise<CatalogRow[]> {
    const sql = db();
    const categoryIds = [...new Set(pairs.map((p) => Number(p.categoryId)))];
    const maxPerCategory = Math.max(...pairs.map((p) => p.limit), 1) + 1;

    return sql<CatalogRow[]>`
      select * from (
        select medication_id, sku, name, active_ingredient, active_ingredient_id,
               category, category_id, category_slug, laboratory, laboratory_id,
               dosage, presentation, price, stock, in_stock, requires_prescription, description,
               row_number() over (partition by category_id order by price asc, medication_id asc) as rn
        from public.medication_catalog_projection
        where category_id = any(${categoryIds})
      ) ranked
      where rn <= ${maxPerCategory}
    `;
  },

  async findByLaboratoryIds(laboratoryIds: readonly string[], perLaboratory: number): Promise<CatalogRow[]> {
    const sql = db();
    return sql<CatalogRow[]>`
      select * from (
        select medication_id, sku, name, active_ingredient, active_ingredient_id,
               category, category_id, category_slug, laboratory, laboratory_id,
               dosage, presentation, price, stock, in_stock, requires_prescription, description,
               row_number() over (partition by laboratory_id order by name asc) as rn
        from public.medication_catalog_projection
        where laboratory_id = any(${laboratoryIds.map(Number)})
      ) ranked
      where rn <= ${perLaboratory}
    `;
  },
};

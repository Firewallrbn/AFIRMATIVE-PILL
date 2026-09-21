import type { GraphQLContext } from '@/server/context';
import { cursor, toMedication, toOrder, type MedicationModel, type OrderModel } from './models';
import {
  catalogReadRepository,
  type MedicationFilterInput,
  type MedicationSortInput,
} from './read-repositories/catalog-read-repository';
import { referenceReadRepository } from './read-repositories/reference-read-repository';
import {
  orderReadRepository,
  readOrderFromWriteModel,
} from './read-repositories/order-read-repository';
import { drainInBackground } from '@/server/projections/projector';

/**
 * ============================================================================
 *  QUERY SIDE — resolvers de lectura
 * ============================================================================
 *
 * Invariante de este archivo: solo lee. No hay un solo INSERT/UPDATE, ni se importa nada
 * de `command-side/`.
 *
 * Dos excepciones, las dos deliberadas y documentadas donde viven:
 *   · `Query.cart` está en el command side — el borrador propio exige read-your-writes.
 *   · `Query.order` cae al write model mientras la proyección está atrasada
 *     (ver `readOrderFromWriteModel`), y lo declara devolviendo `freshness: SYNCING`.
 */

const DEFAULT_SORT: MedicationSortInput = { field: 'RELEVANCE', direction: 'ASC' };

type MedicationsArgs = {
  filter?: MedicationFilterInput | null;
  sort?: MedicationSortInput | null;
  first?: number | null;
  after?: string | null;
};

/** Resultado intermedio: la conexión arrastra el filtro para poder calcular facetas. */
type ConnectionSource = {
  nodes: MedicationModel[];
  totalCount: number;
  offset: number;
  filter: MedicationFilterInput;
};

export const queryResolvers = {
  Query: {
    async medications(_: unknown, args: MedicationsArgs): Promise<ConnectionSource> {
      const filter = args.filter ?? {};
      const sort = args.sort ?? DEFAULT_SORT;
      const first = Math.min(Math.max(args.first ?? 20, 1), 50);
      const offset = cursor.decode(args.after);

      // Dos consultas en paralelo: la página y el total. Nunca N.
      const [rows, totalCount] = await Promise.all([
        catalogReadRepository.search(filter, sort, first + 1, offset),
        catalogReadRepository.count(filter),
      ]);

      return {
        nodes: rows.slice(0, first).map(toMedication),
        totalCount,
        offset,
        filter,
      };
    },

    async medication(_: unknown, { id }: { id: string }, ctx: GraphQLContext) {
      const row = await ctx.loaders.medicationById.load(id);
      return row ? toMedication(row) : null;
    },

    async categories() {
      const rows = await referenceReadRepository.allCategories();
      return rows.map((row) => ({ id: String(row.id), name: row.name, slug: row.slug }));
    },

    async laboratories() {
      const rows = await referenceReadRepository.allLaboratories();
      return rows.map((row) => ({ id: String(row.id), name: row.name }));
    },

    /**
     * Lectura de un pedido, con la ventana de consistencia eventual manejada:
     *
     *   1. camino normal  -> la proyección existe y se devuelve tal cual;
     *   2. ventana        -> la proyección todavía no existe pero el outbox tiene eventos
     *                        pendientes para esa orden: se reconstruye desde el write
     *                        model, se marca SYNCING y se dispara el projector en
     *                        segundo plano (sin bloquear esta respuesta);
     *   3. inexistente    -> ni proyección ni eventos: la orden no existe, `null`.
     */
    async order(_: unknown, { id }: { id: string }, ctx: GraphQLContext) {
      const row = await ctx.loaders.orderById.load(id);
      if (row) return toOrder(row);

      const pending = await ctx.loaders.orderHasPendingEvents.load(id);
      if (!pending) return null;

      drainInBackground('Query.order — proyección atrasada');
      return readOrderFromWriteModel(id);
    },

    async orders(
      _: unknown,
      { patientId, first }: { patientId: string; first?: number | null },
    ): Promise<OrderModel[]> {
      const rows = await orderReadRepository.findByPatient(patientId, Math.min(first ?? 20, 50));
      return rows.map(toOrder);
    },
  },

  // --------------------------------------------------------------- conexión y facetas

  MedicationConnection: {
    edges(source: ConnectionSource) {
      return source.nodes.map((node, index) => ({
        cursor: cursor.encode(source.offset + index + 1),
        node,
      }));
    },
    pageInfo(source: ConnectionSource) {
      const nextOffset = source.offset + source.nodes.length;
      return {
        hasNextPage: nextOffset < source.totalCount,
        endCursor: source.nodes.length ? cursor.encode(nextOffset) : null,
      };
    },
    totalCount: (source: ConnectionSource) => source.totalCount,
    // Las facetas solo se calculan si el cliente las pide: el resolver de campo es la
    // defensa natural contra el over-fetching en el servidor, no solo en el cliente.
    facets: (source: ConnectionSource) => source.filter,
  },

  MedicationFacets: {
    async categories(filter: MedicationFilterInput) {
      const rows = await catalogReadRepository.categoryFacets(filter);
      return rows.map((row) => ({
        categoryId: String(row.category_id),
        count: row.count,
      }));
    },
    async requiresPrescription(filter: MedicationFilterInput) {
      const row = await catalogReadRepository.prescriptionFacet(filter);
      return {
        withPrescription: row.with_prescription,
        overTheCounter: row.over_the_counter,
      };
    },
  },

  CategoryFacet: {
    async category({ categoryId }: { categoryId: string }, _args: unknown, ctx: GraphQLContext) {
      const row = await ctx.loaders.categoryById.load(categoryId);
      return row ? { id: String(row.id), name: row.name, slug: row.slug } : null;
    },
  },

  // --------------------------------------------------------------- entidades anidadas
  //
  // Estos cuatro resolvers son el escenario N+1 del enunciado. Cada uno se ejecuta una
  // vez por medicamento del resultado; ninguno consulta la base directamente.

  Medication: {
    activeIngredient: async (parent: MedicationModel, _args: unknown, ctx: GraphQLContext) => {
      const row = await ctx.loaders.activeIngredientById.load(parent.activeIngredientId);
      return row ? { id: String(row.id), name: row.name } : null;
    },

    laboratory: async (parent: MedicationModel, _args: unknown, ctx: GraphQLContext) => {
      const row = await ctx.loaders.laboratoryById.load(parent.laboratoryId);
      return row ? { id: String(row.id), name: row.name } : null;
    },

    category: async (parent: MedicationModel, _args: unknown, ctx: GraphQLContext) => {
      const row = await ctx.loaders.categoryById.load(parent.categoryId);
      return row ? { id: String(row.id), name: row.name, slug: row.slug } : null;
    },

    relatedMedications: async (
      parent: MedicationModel,
      { first }: { first?: number | null },
      ctx: GraphQLContext,
    ) => {
      const rows = await ctx.loaders.relatedMedications.load({
        categoryId: parent.categoryId,
        excludeMedicationId: parent.id,
        limit: Math.min(first ?? 4, 10),
      });
      return rows.map(toMedication);
    },
  },

  /**
   * Mismo resolver que `Medication.category`, ahora también sobre la vista condensada:
   * es el que convierte una grilla de 20 tarjetas en 20 claves para un solo lote.
   */
  MedicationSummary: {
    category: async (parent: MedicationModel, _args: unknown, ctx: GraphQLContext) => {
      const row = await ctx.loaders.categoryById.load(parent.categoryId);
      return row ? { id: String(row.id), name: row.name, slug: row.slug } : null;
    },
  },

  Category: {
    medicationCount: (parent: { id: string }, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.medicationCountByCategoryId.load(parent.id),
  },

  Laboratory: {
    medications: async (
      parent: { id: string },
      { first }: { first?: number | null },
      ctx: GraphQLContext,
    ) => {
      const rows = await ctx.loaders.medicationsByLaboratoryId.load(parent.id);
      return rows.slice(0, Math.min(first ?? 10, 10)).map(toMedication);
    },
  },

  // --------------------------------------------------------------- pedido proyectado

  OrderProjection: {
    /**
     * Consistencia eventual hecha explícita.
     *
     * Si el outbox todavía tiene eventos sin procesar para esta orden, lo que estamos
     * devolviendo es una foto anterior al último comando. En vez de esconderlo, el
     * contrato lo dice y la UI lo muestra.
     */
    freshness: async (parent: OrderModel, _args: unknown, ctx: GraphQLContext) => {
      const pending = await ctx.loaders.orderHasPendingEvents.load(parent.id);
      return pending ? 'SYNCING' : 'UP_TO_DATE';
    },
  },

  OrderItemProjection: {
    /**
     * Cruce de agregados: la orden guarda el id del medicamento, no su ficha. Resolverlo
     * ítem por ítem sería un N+1 clásico entre bounded contexts; el DataLoader lo agrupa.
     */
    medication: async (
      parent: { medicationId: string },
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      const row = await ctx.loaders.medicationById.load(parent.medicationId);
      return row ? toMedication(row) : null;
    },
  },
};

import { waitUntil } from '@vercel/functions';
import type { GraphQLContext } from '@/server/context';
import { logger } from '@/server/shared/logger';
import { notFound, validation, type CommandErrorShape } from '@/server/shared/errors';
import { toMedication, toOrder, type OrderModel } from '@/server/query-side/models';
import type { CatalogRow } from '@/server/query-side/read-repositories/catalog-read-repository';
import {
  orderReadRepository,
  readOrderFromWriteModel,
} from '@/server/query-side/read-repositories/order-read-repository';
import { drainOutbox } from '@/server/projections/projector';
import { cartWriteRepository, type CartItemRow } from './write-repositories/cart-write-repository';
import { placeOrder } from './handlers/place-order';
import { approveOrder, cancelOrder, dispatchOrder } from './handlers/order-lifecycle';

/**
 * ============================================================================
 *  COMMAND SIDE — resolvers de escritura
 * ============================================================================
 *
 * Cada Mutation traduce una intención de negocio a un command handler y devuelve un
 * payload tipado. Ningún resolver de este archivo contiene reglas de dominio: eso vive
 * en `domain/invariants.ts` y en los handlers, que son testeables sin GraphQL encima.
 */

/**
 * Programa el projector para después de responder.
 *
 * `waitUntil` mantiene viva la función serverless el tiempo necesario para drenar el
 * outbox SIN que el cliente espere. Si no estamos en Vercel (dev local), cae al
 * disparo suelto, que hace lo mismo con un proceso que de todos modos sigue corriendo.
 */
function scheduleProjection(reason: string): void {
  const work = drainOutbox().catch((error) => {
    logger.error({ err: error, reason }, '[projector] fallo al drenar el outbox');
    return 0;
  });
  try {
    waitUntil(work);
  } catch {
    void work;
  }
}

function subtotal(items: CartItemRow[]): number {
  return items.reduce((total, item) => total + Number(item.price) * item.quantity, 0);
}

type CartSource = { id: string; patientId: string; status: string; updatedAt: Date };

async function loadCart(cartId: string): Promise<CartSource | null> {
  const cart = await cartWriteRepository.findById(cartId);
  if (!cart) return null;
  return {
    id: String(cart.id),
    patientId: cart.patient_id,
    status: cart.status,
    updatedAt: cart.updated_at,
  };
}

/** Respuesta estándar de los comandos de carrito: el carrito o los errores, nunca ambos. */
async function cartPayload(cartId: string, errors: CommandErrorShape[] = []) {
  if (errors.length > 0) return { cart: null, errors };
  const cart = await loadCart(cartId);
  if (!cart) return { cart: null, errors: [notFound('el carrito', cartId)] };
  return { cart, errors: [] };
}

/** Respuesta estándar de los comandos de orden: siempre desde la proyección de lectura. */
async function orderPayload(orderId: string | null, errors: CommandErrorShape[]) {
  if (!orderId || errors.length > 0) return { order: null, errors };
  const row = await orderReadRepository.findById(orderId);
  const order = row ? toOrder(row) : await readOrderFromWriteModel(orderId);
  return { order, errors: [] };
}

export const commandResolvers = {
  Query: {
    /**
     * Excepción documentada a "solo se lee de proyecciones": el carrito es el borrador
     * privado del paciente y exige read-your-writes. Vive acá, en el command side, para
     * que la excepción esté a la vista y no escondida entre los resolvers de lectura.
     */
    cart: (_: unknown, { id }: { id: string }) => loadCart(id),
  },

  Mutation: {
    async createCart(_: unknown, { patientId }: { patientId: string }) {
      if (!patientId?.trim()) {
        return { cart: null, errors: [validation('patientId', 'El paciente es obligatorio.')] };
      }
      const cart = await cartWriteRepository.create(patientId);
      scheduleProjection('createCart');
      return cartPayload(String(cart.id));
    },

    async addMedicationToCart(
      _: unknown,
      { input }: { input: { cartId: string; medicationId: string; quantity: number } },
      ctx: GraphQLContext,
    ) {
      const cart = await cartWriteRepository.findById(input.cartId);
      if (!cart) return { cart: null, errors: [notFound('el carrito', input.cartId)] };

      const medication = await ctx.loaders.medicationById.load(input.medicationId);
      if (!medication) {
        return { cart: null, errors: [notFound('el medicamento', input.medicationId)] };
      }

      // Aviso temprano de faltante. El control definitivo es el UPDATE condicional
      // dentro de la transacción de `placeOrder`: entre agregar al carrito y comprar
      // pueden pasar horas y el inventario cambia.
      if (!medication.in_stock) {
        return {
          cart: null,
          errors: [
            {
              __typename: 'OutOfStockError' as const,
              code: 'OUT_OF_STOCK' as const,
              message: `${medication.name} está agotado en bodega.`,
              medicationId: input.medicationId,
              medicationName: medication.name,
              requested: input.quantity,
              available: medication.stock,
            },
          ],
        };
      }

      await cartWriteRepository.addItem(input.cartId, input.medicationId, input.quantity);
      scheduleProjection('addMedicationToCart');
      return cartPayload(input.cartId);
    },

    async removeMedicationFromCart(
      _: unknown,
      { input }: { input: { cartId: string; medicationId: string } },
    ) {
      const cart = await cartWriteRepository.findById(input.cartId);
      if (!cart) return { cart: null, errors: [notFound('el carrito', input.cartId)] };
      await cartWriteRepository.removeItem(input.cartId, input.medicationId);
      return cartPayload(input.cartId);
    },

    async attachPrescriptionToCart(
      _: unknown,
      {
        input,
      }: {
        input: {
          cartId: string;
          prescription: {
            doctorName: string;
            medicalLicense: string;
            issuedAt: string;
            documentUrl: string;
          };
        };
      },
    ) {
      const cart = await cartWriteRepository.findById(input.cartId);
      if (!cart) return { cart: null, errors: [notFound('el carrito', input.cartId)] };

      // Una fórmula médica con fecha futura no existe; es un dato mal capturado.
      const issued = new Date(input.prescription.issuedAt);
      if (Number.isNaN(issued.getTime()) || issued.getTime() > Date.now()) {
        return {
          cart: null,
          errors: [
            validation('prescription.issuedAt', 'La fecha de expedición no puede ser futura.'),
          ],
        };
      }

      await cartWriteRepository.attachPrescription(input.cartId, input.prescription);
      scheduleProjection('attachPrescriptionToCart');
      return cartPayload(input.cartId);
    },

    async placeOrder(
      _: unknown,
      { input }: { input: { cartId: string; idempotencyKey: string } },
    ) {
      const result = await placeOrder(input);
      if (result.errors.length > 0 || !result.orderId) {
        return { order: null, errors: result.errors };
      }

      scheduleProjection('placeOrder');

      // Proyección optimista: la orden existe y es real, pero el read model todavía no
      // la alcanzó. `freshness` va a reportar SYNCING y la UI lo va a decir.
      const order = await readOrderFromWriteModel(result.orderId);
      return { order, errors: [] };
    },

    async approveOrder(_: unknown, { orderId }: { orderId: string }) {
      const result = await approveOrder(orderId);
      if (result.errors.length === 0) scheduleProjection('approveOrder');
      return orderPayload(result.orderId, result.errors);
    },

    async dispatchOrder(_: unknown, { orderId }: { orderId: string }) {
      const result = await dispatchOrder(orderId);
      if (result.errors.length === 0) scheduleProjection('dispatchOrder');
      return orderPayload(result.orderId, result.errors);
    },

    async cancelOrder(_: unknown, { orderId, reason }: { orderId: string; reason: string }) {
      const result = await cancelOrder(orderId, reason);
      if (result.errors.length === 0) scheduleProjection('cancelOrder');
      return orderPayload(result.orderId, result.errors);
    },
  },

  // --------------------------------------------------------------- carrito

  Cart: {
    async items(parent: CartSource) {
      const rows = await cartWriteRepository.findItems(parent.id);
      return rows.map((row) => ({
        medicationId: String(row.medication_id),
        quantity: row.quantity,
        unitPrice: Number(row.price),
        lineTotal: Number(row.price) * row.quantity,
      }));
    },

    async subtotal(parent: CartSource) {
      return subtotal(await cartWriteRepository.findItems(parent.id));
    },

    async requiresPrescription(parent: CartSource) {
      const rows = await cartWriteRepository.findItems(parent.id);
      return rows.some((row) => row.requires_prescription);
    },

    async prescription(parent: CartSource) {
      const row = await cartWriteRepository.findPrescription(parent.id);
      return row
        ? {
            id: String(row.id),
            doctorName: row.doctor_name,
            medicalLicense: row.medical_license,
            issuedAt: row.issued_at,
            documentUrl: row.document_url,
            status: row.status,
          }
        : null;
    },
  },

  CartItem: {
    medication: async (
      parent: { medicationId: string },
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      const row = await ctx.loaders.medicationById.load(parent.medicationId);
      return row ? toMedication(row) : null;
    },
  },

  // --------------------------------------------------------------- errores tipados

  CommandError: {
    __resolveType: (error: { __typename: string }) => error.__typename,
  },

  PrescriptionRequiredError: {
    /**
     * El error viaja con ids; el cliente necesita nombres para decir *cuáles* medicamentos
     * exigen receta. Se expanden por DataLoader: un error con 5 medicamentos sigue
     * costando una sola consulta.
     */
    medications: async (
      parent: { medicationIds: string[] },
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      const rows = await ctx.loaders.medicationById.loadMany(parent.medicationIds);
      return rows
        .filter((row): row is CatalogRow => Boolean(row) && !(row instanceof Error))
        .map(toMedication);
    },
  },
};

export type { OrderModel };

import type { CatalogRow } from './read-repositories/catalog-read-repository';
import type { OrderProjectionRow } from './read-repositories/order-read-repository';

/**
 * Traductores fila-de-Postgres -> modelo del contrato.
 *
 * Existen para que ningún resolver tenga que conocer los nombres de columna. El read
 * model puede renombrar `in_stock` mañana sin que se entere una sola línea del schema.
 */

export type MedicationModel = {
  id: string;
  sku: string;
  name: string;
  dosage: string;
  presentation: string;
  price: number;
  stock: number;
  inStock: boolean;
  requiresPrescription: boolean;
  description: string;
  // Claves foráneas que alimentan los DataLoaders de los resolvers anidados.
  activeIngredientId: string;
  laboratoryId: string;
  categoryId: string;
};

export function toMedication(row: CatalogRow): MedicationModel {
  return {
    id: String(row.medication_id),
    sku: row.sku,
    name: row.name,
    dosage: row.dosage,
    presentation: row.presentation,
    price: Number(row.price),
    stock: row.stock,
    inStock: row.in_stock,
    requiresPrescription: row.requires_prescription,
    description: row.description,
    activeIngredientId: String(row.active_ingredient_id),
    laboratoryId: String(row.laboratory_id),
    categoryId: String(row.category_id),
  };
}

export type OrderModel = {
  id: string;
  patientId: string;
  status: string;
  total: number;
  items: {
    medicationId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  requiresPrescription: boolean;
  prescriptionStatus: string;
  cancellationReason: string | null;
  placedAt: Date;
  updatedAt: Date;
  version: number;
};

export function toOrder(row: OrderProjectionRow): OrderModel {
  return {
    id: String(row.order_id),
    patientId: row.patient_id,
    status: row.status,
    total: Number(row.total),
    items: (row.items ?? []).map((item) => ({
      medicationId: String(item.medicationId),
      name: item.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
    requiresPrescription: row.requires_prescription,
    prescriptionStatus: row.prescription_status,
    cancellationReason: row.cancellation_reason,
    placedAt: row.placed_at,
    updatedAt: row.updated_at,
    version: Number(row.projection_version),
  };
}

/** Cursor opaco de paginación: un offset codificado, para no filtrar el modelo interno. */
export const cursor = {
  encode(offset: number): string {
    return Buffer.from(`offset:${offset}`, 'utf8').toString('base64url');
  },
  decode(value?: string | null): number {
    if (!value) return 0;
    try {
      const decoded = Buffer.from(value, 'base64url').toString('utf8');
      const parsed = Number(decoded.replace('offset:', ''));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  },
};

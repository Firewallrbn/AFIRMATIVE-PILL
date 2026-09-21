/**
 * Tipos del contrato, del lado del cliente.
 *
 * Escritos a mano y espejando `schema.graphql`. En un proyecto de largo aliento esto lo
 * generaría `graphql-codegen` desde el SDL; acá se mantienen a mano y acotados a lo que
 * las cuatro pantallas realmente consumen.
 */

export type MedicationSummary = {
  id: string;
  sku: string;
  name: string;
  dosage: string;
  presentation: string;
  price: number;
  requiresPrescription: boolean;
  inStock: boolean;
  category: { id: string; name: string };
};

export type MedicationDetail = MedicationSummary & {
  stock: number;
  description: string;
  activeIngredient: { id: string; name: string };
  laboratory: { id: string; name: string };
  category: { id: string; name: string; slug: string };
  relatedMedications: MedicationSummary[];
};

export type Category = { id: string; name: string; slug: string; medicationCount?: number };

export type MedicationConnection = {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: { cursor: string; node: MedicationSummary }[];
  facets: {
    requiresPrescription: { withPrescription: number; overTheCounter: number };
    categories: { count: number; category: Category }[];
  };
};

export type CartItem = {
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  medication: MedicationSummary;
};

export type Prescription = {
  id: string;
  doctorName: string;
  medicalLicense: string;
  issuedAt: string;
  status: 'NOT_REQUIRED' | 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED';
};

export type Cart = {
  id: string;
  patientId: string;
  status: 'OPEN' | 'CHECKED_OUT' | 'ABANDONED';
  subtotal: number;
  requiresPrescription: boolean;
  updatedAt: string;
  prescription: Prescription | null;
  items: CartItem[];
};

export type OrderStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISPATCHED' | 'CANCELLED';

export type OrderProjection = {
  id: string;
  status: OrderStatus;
  total: number;
  requiresPrescription: boolean;
  prescriptionStatus: 'NOT_REQUIRED' | 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED';
  cancellationReason: string | null;
  placedAt: string;
  updatedAt: string;
  /** El campo que hace explícita la consistencia eventual. */
  freshness: 'UP_TO_DATE' | 'SYNCING';
  version: number;
  items: {
    medicationId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
};

/** Errores de comando, tal como llegan dentro del payload de cada mutación. */
export type CommandError = {
  __typename: string;
  code: string;
  message: string;
  medicationId?: string;
  medicationName?: string;
  requested?: number;
  available?: number;
  medications?: { id: string; name: string }[];
  field?: string;
  currentStatus?: string;
  attemptedTransition?: string;
  resource?: string;
  id?: string;
};

/** Formato de moneda colombiana: sin decimales, que es como se cotizan los medicamentos. */
export const formatCOP = (value: number): string =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);

import {
  outOfStock,
  prescriptionRequired,
  type CommandErrorShape,
} from '@/server/shared/errors';

/**
 * ============================================================================
 *  Invariantes del dominio farmacéutico
 * ============================================================================
 *
 * Reglas que NO pueden romperse nunca, expresadas una sola vez y en un módulo sin
 * dependencias de infraestructura: no sabe de Postgres, de GraphQL ni de HTTP. Eso las
 * vuelve verificables con pruebas unitarias directas (`src/server/command-side/domain/*.test.ts`).
 *
 * Son dos, y las dos vienen del enunciado:
 *
 *   1. Un pedido que incluya medicamentos de venta bajo fórmula médica no puede
 *      transicionar a aceptado sin la prescripción de soporte.
 *   2. No se puede vender inventario que no existe.
 */

export type OrderLine = {
  medicationId: string;
  medicationName: string;
  quantity: number;
  requiresPrescription: boolean;
  availableStock: number;
  unitPrice: number;
};

export type PrescriptionSupport = {
  doctorName: string;
  medicalLicense: string;
  issuedAt: string;
  documentUrl: string;
} | null;

/**
 * INVARIANTE 1 — control de prescripción.
 *
 * Devuelve error si alguna línea exige fórmula y no hay prescripción adjunta.
 * Nota: no valida la autenticidad de la receta (eso lo hace el químico farmacéutico en
 * el paso `approveOrder`); valida que el soporte EXISTA antes de comprometer inventario.
 */
export function checkPrescription(
  lines: OrderLine[],
  prescription: PrescriptionSupport,
): CommandErrorShape | null {
  const controlled = lines.filter((line) => line.requiresPrescription);
  if (controlled.length === 0) return null;
  if (prescription) return null;
  return prescriptionRequired(controlled.map((line) => line.medicationId));
}

/**
 * INVARIANTE 2 — disponibilidad de inventario.
 *
 * Verificación previa, para poder devolver TODOS los faltantes de una vez en lugar de
 * que el paciente descubra uno por intento. No sustituye al control atómico del `UPDATE
 * ... WHERE stock >= cantidad` dentro de la transacción: entre esta validación y el
 * commit puede colarse otra compra. Esto es UX; aquello es correctitud.
 */
export function checkStock(lines: OrderLine[]): CommandErrorShape[] {
  return lines
    .filter((line) => line.availableStock < line.quantity)
    .map((line) =>
      outOfStock(line.medicationId, line.medicationName, line.quantity, line.availableStock),
    );
}

/** Total del pedido. Se calcula en el servidor: el precio nunca llega desde el cliente. */
export function calculateTotal(lines: OrderLine[]): number {
  return lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
}

/** ¿El pedido completo exige fórmula médica? */
export function requiresPrescription(lines: OrderLine[]): boolean {
  return lines.some((line) => line.requiresPrescription);
}

/**
 * Transiciones válidas del ciclo de vida de una orden.
 * Cualquier otro salto es un `InvalidStateError`, no una excepción del servidor.
 */
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: [],
  CANCELLED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

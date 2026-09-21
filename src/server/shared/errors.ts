/**
 * Errores de comando.
 *
 * Todos implementan la interfaz `CommandError` del SDL y viajan DENTRO del payload de la
 * mutación. El `__typename` explícito es lo que permite al cliente hacer
 * `... on OutOfStockError { available }` y pintar el error en el campo correcto.
 */

export type CommandErrorShape =
  | OutOfStockError
  | PrescriptionRequiredError
  | ValidationError
  | NotFoundError
  | InvalidStateError;

export interface OutOfStockError {
  __typename: 'OutOfStockError';
  code: 'OUT_OF_STOCK';
  message: string;
  medicationId: string;
  medicationName: string;
  requested: number;
  available: number;
}

export interface PrescriptionRequiredError {
  __typename: 'PrescriptionRequiredError';
  code: 'PRESCRIPTION_REQUIRED';
  message: string;
  /** Ids de los medicamentos que exigen fórmula. El resolver los expande vía DataLoader. */
  medicationIds: string[];
}

export interface ValidationError {
  __typename: 'ValidationError';
  code: 'VALIDATION_ERROR';
  message: string;
  field: string;
}

export interface NotFoundError {
  __typename: 'NotFoundError';
  code: 'NOT_FOUND';
  message: string;
  resource: string;
  id: string;
}

export interface InvalidStateError {
  __typename: 'InvalidStateError';
  code: 'INVALID_STATE';
  message: string;
  currentStatus: string;
  attemptedTransition: string;
}

export const outOfStock = (
  medicationId: string,
  medicationName: string,
  requested: number,
  available: number,
): OutOfStockError => ({
  __typename: 'OutOfStockError',
  code: 'OUT_OF_STOCK',
  message:
    available === 0
      ? `${medicationName} está agotado en bodega.`
      : `Solo quedan ${available} unidades de ${medicationName} y pediste ${requested}.`,
  medicationId,
  medicationName,
  requested,
  available,
});

export const prescriptionRequired = (medicationIds: string[]): PrescriptionRequiredError => ({
  __typename: 'PrescriptionRequiredError',
  code: 'PRESCRIPTION_REQUIRED',
  message:
    medicationIds.length === 1
      ? 'Uno de los medicamentos del pedido es de venta bajo fórmula médica. Adjuntá la prescripción antes de continuar.'
      : `${medicationIds.length} medicamentos del pedido son de venta bajo fórmula médica. Adjuntá la prescripción antes de continuar.`,
  medicationIds,
});

export const validation = (field: string, message: string): ValidationError => ({
  __typename: 'ValidationError',
  code: 'VALIDATION_ERROR',
  message,
  field,
});

export const notFound = (resource: string, id: string): NotFoundError => ({
  __typename: 'NotFoundError',
  code: 'NOT_FOUND',
  message: `No encontramos ${resource} con id ${id}.`,
  resource,
  id,
});

export const invalidState = (
  currentStatus: string,
  attemptedTransition: string,
  message: string,
): InvalidStateError => ({
  __typename: 'InvalidStateError',
  code: 'INVALID_STATE',
  message,
  currentStatus,
  attemptedTransition,
});

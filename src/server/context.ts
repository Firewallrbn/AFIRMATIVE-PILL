import { createLoaders, type Loaders } from '@/server/loaders';

/**
 * Contexto de ejecución de GraphQL.
 *
 * Se construye UNA VEZ POR REQUEST. Su razón de ser es el ciclo de vida de los
 * DataLoaders: viven exactamente lo que vive la petición y mueren con ella. Ese es el
 * "caché por request" que pide el enunciado — agrupa dentro de una operación y nunca
 * entre operaciones, de modo que dos pacientes jamás comparten una vista del inventario.
 */
export type GraphQLContext = {
  requestId: string;
  loaders: Loaders;
  /**
   * Paciente que ejecuta la operación. En un sistema real saldría de un JWT verificado;
   * acá llega por cabecera para mantener la demo simple sin introducir un endpoint de
   * login REST (que violaría el mandato Zero-REST).
   */
  patientId: string;
};

export const DEMO_PATIENT_ID = 'paciente-demo';

export function createContext(request?: Request): GraphQLContext {
  const requestId =
    request?.headers.get('x-request-id') ??
    (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

  return {
    requestId,
    loaders: createLoaders(),
    patientId: request?.headers.get('x-patient-id') ?? DEMO_PATIENT_ID,
  };
}

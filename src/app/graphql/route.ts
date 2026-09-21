import { startServerAndCreateNextHandler } from '@as-integrations/next';
import { createHandler } from 'graphql-sse/lib/use/fetch';
import { apolloServer } from '@/server/apollo';
import { createContext, type GraphQLContext } from '@/server/context';
import { schema } from '@/server/schema';
import { requestScope } from '@/server/shared/db';

/**
 * ============================================================================
 *  /graphql — EL ÚNICO ENDPOINT DE RED DE LA APLICACIÓN
 * ============================================================================
 *
 * Mandato Zero-REST del enunciado: no existe ninguna otra ruta de servidor en este
 * proyecto. Ni `/api/medicamentos`, ni `/api/login`, ni `/api/orden/123`. Catálogo,
 * carrito, compra y seguimiento en tiempo real entran y salen por acá.
 *
 * La ruta vive en `app/graphql/` y no en `app/api/graphql/` a propósito: en la pestaña
 * Network de la sustentación se lee literalmente `POST /graphql`, sin prefijos que
 * hagan dudar de si hay una API REST debajo.
 *
 * Dos protocolos, un solo endpoint:
 *   · POST con `accept: application/json`   -> queries y mutations (Apollo Server)
 *   · POST con `accept: text/event-stream`  -> subscriptions (graphql-sse)
 */

// Runtime Node.js, nunca Edge: el driver de Postgres necesita sockets TCP.
export const runtime = 'nodejs';
// Las subscriptions SSE mantienen la conexión abierta; sin esto Vercel la cortaría.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const apolloHandler = startServerAndCreateNextHandler<Request, GraphQLContext>(apolloServer(), {
  context: async (request) => createContext(request),
});

const sseHandler = createHandler({
  schema,
  context: (request) => createContext(request as unknown as Request),
});

function wantsEventStream(request: Request): boolean {
  return request.headers.get('accept')?.includes('text/event-stream') ?? false;
}

/**
 * Cada request corre dentro de su propio `AsyncLocalStorage`.
 *
 * Eso es lo que permite contar las consultas SQL de UNA operación sin ensuciar el
 * contador de las demás, que es la evidencia de la mitigación del N+1.
 */
async function handle(request: Request): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();

  return requestScope.run({ requestId, operation: '', sqlCount: 0 }, async () => {
    if (wantsEventStream(request)) {
      return sseHandler(request);
    }
    return apolloHandler(request);
  });
}

export { handle as GET, handle as POST };

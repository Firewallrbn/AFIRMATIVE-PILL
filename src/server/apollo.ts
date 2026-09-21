import { ApolloServer } from '@apollo/server';
import type { GraphQLContext } from './context';
import { schema } from './schema';
import { logger } from './shared/logger';
import { currentScope } from './shared/db';

/**
 * Instancia de Apollo Server.
 *
 * Cacheada en `globalThis` porque en Fluid Compute la misma instancia de la función
 * atiende varias invocaciones: reconstruir y revalidar el schema en cada request sería
 * puro desperdicio.
 */

const globalForApollo = globalThis as unknown as {
  __afirmativePillApollo?: ApolloServer<GraphQLContext>;
};

function createServer() {
  return new ApolloServer<GraphQLContext>({
    schema,
    // El introspection queda habilitado a propósito: la sustentación del taller se apoya
    // en Apollo Sandbox para recorrer el contrato en vivo.
    introspection: true,
    includeStacktraceInErrorResponses: process.env.NODE_ENV !== 'production',
    plugins: [
      {
        /**
         * Plugin de observabilidad del N+1.
         *
         * Cierra cada operación informando cuántas consultas SQL costó. Es la evidencia
         * que pide el entregable: la misma query anidada, con y sin DataLoader, se
         * distingue de un vistazo en la consola del servidor.
         */
        async requestDidStart(requestContext) {
          const startedAt = Date.now();
          const operation = requestContext.request.operationName ?? 'anónima';

          return {
            async willSendResponse() {
              const scope = currentScope();
              logger.info(
                {
                  requestId: scope?.requestId,
                  operation,
                  sqlQueries: scope?.sqlCount ?? 0,
                  ms: Date.now() - startedAt,
                },
                `[graphql] ${operation} resuelta con ${scope?.sqlCount ?? 0} consulta(s) SQL`,
              );
            },
          };
        },
      },
    ],
  });
}

export function apolloServer(): ApolloServer<GraphQLContext> {
  // En desarrollo NO se cachea: el schema se reconstruye en cada recarga del módulo.
  // Si se cacheara, al editar un `.graphql` el HMR recargaría el código pero seguiría
  // sirviendo el schema viejo, y los cambios del contrato parecerían no aplicarse.
  if (process.env.NODE_ENV !== 'production') return createServer();

  if (!globalForApollo.__afirmativePillApollo) {
    globalForApollo.__afirmativePillApollo = createServer();
  }
  return globalForApollo.__afirmativePillApollo;
}

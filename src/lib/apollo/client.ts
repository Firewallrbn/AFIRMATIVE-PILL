import { ApolloClient, InMemoryCache } from '@apollo/client';
import { HttpLink } from '@apollo/client/link/http';
import { ApolloLink } from '@apollo/client/link';
import { getMainDefinition } from '@apollo/client/utilities';
import { GraphQLSSELink } from './sse-link';

/**
 * ============================================================================
 *  Apollo Client — configuración única del canal de datos
 * ============================================================================
 *
 * Todo el tráfico de la aplicación sale de acá. No hay `fetch()` a ninguna otra ruta en
 * todo el frontend: ese es el mandato Zero-REST del enunciado, y este archivo es el
 * único lugar donde el cliente sabe que existe una red.
 */

/** Ruta relativa: mismo origen que la app, sin CORS y sin URL de backend que configurar. */
const GRAPHQL_ENDPOINT = '/graphql';

function createLink(): ApolloLink {
  const httpLink = new HttpLink({ uri: GRAPHQL_ENDPOINT });

  // En el servidor (RSC/prerender) no hay subscriptions que atender.
  if (typeof window === 'undefined') return httpLink;

  const sseLink = new GraphQLSSELink(GRAPHQL_ENDPOINT);

  // Las subscriptions van por SSE; queries y mutations por POST. Mismo endpoint.
  return ApolloLink.split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
    },
    sseLink,
    httpLink,
  );
}

function createCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: {
      /**
       * Normalización explícita. Sin esto, la ficha detallada de un medicamento y su
       * tarjeta en el listado serían dos objetos distintos en el caché, y actualizar el
       * stock después de una compra dejaría la grilla mostrando datos viejos.
       */
      Medication: { keyFields: ['id'] },
      MedicationSummary: { keyFields: ['id'] },
      OrderProjection: { keyFields: ['id'] },
      Cart: { keyFields: ['id'] },
      Category: { keyFields: ['id'] },
      Laboratory: { keyFields: ['id'] },

      Query: {
        fields: {
          /**
           * Paginación acumulativa del catálogo.
           *
           * `keyArgs` incluye filtro y orden pero NO el cursor: cada combinación de
           * filtros mantiene su propia lista, y pedir la página siguiente concatena en
           * lugar de reemplazar. Así "Ver más" no parpadea ni vuelve a pedir lo que ya
           * está en memoria.
           */
          medications: {
            keyArgs: ['filter', 'sort'],
            merge(existing, incoming, { args }) {
              if (!existing || !args?.after) return incoming;
              return {
                ...incoming,
                edges: [...(existing.edges ?? []), ...(incoming.edges ?? [])],
              };
            },
          },
        },
      },
    },
  });
}

export function makeApolloClient(): ApolloClient {
  return new ApolloClient({
    link: createLink(),
    cache: createCache(),
    devtools: { enabled: true },
  });
}

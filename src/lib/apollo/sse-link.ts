import { ApolloLink } from '@apollo/client/link';
import { print } from 'graphql';
import { createClient, type Client } from 'graphql-sse';
import { Observable } from 'rxjs';

/**
 * Link de Apollo Client para GraphQL Subscriptions sobre Server-Sent Events.
 *
 * Apollo Client trae link para WebSocket (`GraphQLWsLink`) pero no para SSE, así que
 * este es el puente: envuelve el cliente de `graphql-sse` en un `ApolloLink` para que
 * `useSubscription` funcione igual que con cualquier otro transporte.
 *
 * Por qué SSE y no WebSocket: la app corre en funciones serverless de Vercel. SSE es
 * HTTP plano — viaja por el MISMO endpoint `/graphql`, sin upgrade de protocolo, sin
 * segundo puerto y sin infraestructura extra. En la pestaña Network de la sustentación
 * se ve una sola URL para absolutamente todo el tráfico de la aplicación.
 */
export class GraphQLSSELink extends ApolloLink {
  private readonly client: Client;

  constructor(url: string) {
    super();
    this.client = createClient({
      url,
      // Conexiones distintas por operación: cada subscription abre su propio stream.
      // Es lo más simple de razonar y lo que mejor se lleva con una función serverless,
      // que no puede sostener una sesión compartida entre invocaciones.
      singleConnection: false,
      retryAttempts: 5,
    });
  }

  request(operation: ApolloLink.Operation): Observable<ApolloLink.Result> {
    return new Observable((observer) => {
      return this.client.subscribe(
        {
          operationName: operation.operationName,
          query: print(operation.query),
          variables: operation.variables as Record<string, unknown>,
        },
        {
          next: (data) => observer.next(data as ApolloLink.Result),
          error: (error) => observer.error(error),
          complete: () => observer.complete(),
        },
      );
    });
  }
}

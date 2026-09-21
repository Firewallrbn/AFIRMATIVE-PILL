'use client';

import { useMemo, type ReactNode } from 'react';
import { ApolloProvider } from '@apollo/client/react';
import { makeApolloClient } from './client';

/**
 * Árbol de contexto de Apollo.
 *
 * Se monta en `app/layout.tsx`, o sea en la raíz absoluta de la aplicación: cualquier
 * componente de cualquier ruta puede usar `useQuery`, `useMutation` o `useSubscription`
 * sin volver a configurar nada, y todos comparten UN solo caché normalizado en memoria.
 *
 * `useMemo` sin dependencias garantiza una única instancia por sesión de navegador: si
 * el cliente se recreara en cada render, el caché se perdería y cada navegación
 * volvería a pedir al servidor lo que ya tenía.
 */
export function ApolloWrapper({ children }: { children: ReactNode }) {
  const client = useMemo(() => makeApolloClient(), []);

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

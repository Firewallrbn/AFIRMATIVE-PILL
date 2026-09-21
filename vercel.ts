import type { VercelConfig } from '@vercel/config/v1';

/**
 * Configuración del proyecto en Vercel.
 *
 * Deliberadamente mínima. Lo que de verdad importa para este proyecto —el runtime Node.js
 * y la duración extendida de `/graphql`, que las subscriptions SSE necesitan para sostener
 * el stream abierto— se declara en el propio route handler con los exports de segmento:
 *
 *     // src/app/graphql/route.ts
 *     export const runtime = 'nodejs';
 *     export const maxDuration = 300;
 *
 * Esa es la forma correcta en App Router: la configuración viaja con el código de la ruta
 * en lugar de vivir en un archivo aparte que hay que acordarse de actualizar.
 */
export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: 'npm run build',
};

export default config;

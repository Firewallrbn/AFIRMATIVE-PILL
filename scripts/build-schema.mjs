#!/usr/bin/env node
/**
 * Ensambla el SDL modular en dos artefactos:
 *
 *   1. `schema.graphql` en la raíz  -> entregable del taller, se lee de corrido.
 *   2. `src/server/schema/typeDefs.generated.ts` -> el SDL como string embebido.
 *
 * El (2) existe porque en Vercel la función serverless no tiene garantizado el acceso a
 * los `.graphql` sueltos del repo: el bundler solo empaqueta lo que puede ver en un
 * `import`. Embebiendo el SDL en un módulo TypeScript, el contrato viaja con el bundle.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(root, 'src', 'server', 'schema');

// El orden importa solo para la legibilidad del entregable: GraphQL no exige
// declarar un tipo antes de usarlo.
const modules = ['scalars', 'catalog', 'ordering', 'root'];

const banner = `# ============================================================================
#  AFIRMATIVE PILL — Schema GraphQL completo
#
#  ARCHIVO GENERADO. No editar a mano: se ensambla con \`npm run schema\` a partir de
#  los módulos en src/server/schema/ (${modules.map((m) => `${m}.graphql`).join(', ')}).
#
#  Es el contrato único entre el cliente y el servidor. No existe ningún endpoint REST:
#  todo el tráfico de la aplicación cursa por POST /graphql (y SSE para subscriptions).
# ============================================================================

`;

const sdl = modules
  .map((name) => readFileSync(join(schemaDir, `${name}.graphql`), 'utf8').trimEnd())
  .join('\n\n');

writeFileSync(join(root, 'schema.graphql'), `${banner}${sdl}\n`, 'utf8');

mkdirSync(schemaDir, { recursive: true });
writeFileSync(
  join(schemaDir, 'typeDefs.generated.ts'),
  `/* eslint-disable */\n// ARCHIVO GENERADO por scripts/build-schema.mjs — no editar a mano.\n` +
    `export const typeDefs = ${JSON.stringify(sdl)};\n`,
  'utf8',
);

const lines = sdl.split('\n').length;
console.log(`schema.graphql ensamblado desde ${modules.length} módulos (${lines} líneas).`);

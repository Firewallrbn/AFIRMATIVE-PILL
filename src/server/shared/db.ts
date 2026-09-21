import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import { logger } from './logger';

/**
 * Contador de SQL por request.
 *
 * Existe para hacer auditable la mitigación del N+1: cada respuesta GraphQL termina
 * diciendo en el log cuántas consultas costó. Una query anidada de 20 medicamentos
 * debe cerrar en 4 SQL, no en 61. Si alguien rompe un DataLoader, el número salta.
 */
type RequestScope = { requestId: string; operation: string; sqlCount: number };

export const requestScope = new AsyncLocalStorage<RequestScope>();

export function currentScope(): RequestScope | undefined {
  return requestScope.getStore();
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Falta DATABASE_URL. Usar la cadena del pooler de Supabase en modo transacción (puerto 6543). ' +
        'En local: `vercel env pull .env.local`.',
    );
  }
  return url;
}

/**
 * Cliente de Postgres contra Supabase.
 *
 * `prepare: false` es obligatorio: el pooler en modo transacción reparte la conexión
 * entre requests y los prepared statements con nombre se pierden entre una y otra.
 * `max` bajo porque en Vercel cada instancia Fluid abre su propio pool y el proyecto
 * tiene un techo de conexiones compartido.
 */
function createClient(url: string, max: number) {
  return postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    transform: { undefined: null },
    debug(_connection, query) {
      const scope = currentScope();
      if (scope) scope.sqlCount += 1;
      logger.debug(
        { requestId: scope?.requestId, sql: compact(query) },
        `  └─ SQL${scope ? ` #${scope.sqlCount}` : ''}`,
      );
    },
  });
}

function compact(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 220);
}

export type Sql = ReturnType<typeof createClient>;

/**
 * Una sola instancia por proceso, creada de forma perezosa.
 *
 * Perezosa porque `next build` importa estos módulos sin variables de entorno de runtime
 * y no queremos que el build falle por falta de credenciales. Cacheada en `globalThis`
 * porque Fluid Compute reutiliza la instancia de la función entre invocaciones: el pool
 * sobrevive y nos ahorramos el handshake de conexión en cada request.
 */
const globalForDb = globalThis as unknown as {
  __afirmativePillSql?: Sql;
  __afirmativePillListener?: Sql;
};

export function db(): Sql {
  if (!globalForDb.__afirmativePillSql) {
    globalForDb.__afirmativePillSql = createClient(connectionString(), Number(process.env.PG_POOL_MAX ?? 3));
  }
  return globalForDb.__afirmativePillSql;
}

/**
 * Conexión dedicada para `LISTEN order_changed`, que alimenta las GraphQL Subscriptions.
 *
 * Va aparte y contra `DIRECT_URL` porque LISTEN necesita una sesión persistente: el
 * pooler en modo transacción devuelve la conexión al pool al terminar cada transacción
 * y con ella se perdería la suscripción al canal.
 */
export function listenerDb(): Sql {
  if (!globalForDb.__afirmativePillListener) {
    const url = process.env.DIRECT_URL ?? connectionString();
    globalForDb.__afirmativePillListener = createClient(url, 1);
  }
  return globalForDb.__afirmativePillListener;
}

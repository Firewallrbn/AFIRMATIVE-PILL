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
      'Falta DATABASE_URL. Usar la cadena del pooler de Supabase en modo sesión (puerto 5432). ' +
        'En local: `vercel env pull .env.local`.',
    );
  }
  return url;
}

/**
 * Cliente de Postgres contra Supabase.
 *
 * Va contra el pooler en modo SESIÓN (5432). El modo transacción (6543) deja consultas
 * colgadas con postgres.js bajo concurrencia. `prepare: false` se mantiene por si se
 * vuelve a un pooler en modo transacción, donde los prepared statements se pierden.
 * `max` bajo porque en Vercel cada instancia Fluid abre su propio pool y el proyecto
 * tiene un techo de conexiones compartido.
 */
function createClient(url: string, max: number) {
  return instrument(
    postgres(url, {
      max,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      transform: { undefined: null },
      // Solo registra el texto. NO cuenta: este hook corre cuando la consulta sale por el
      // socket, y si en ese momento se está abriendo una conexión, corre en el contexto
      // de quien la abrió — la consulta se le anotaría a otra operación (o a ninguna).
      debug(_connection, query) {
        const text = compact(query);
        if (DRIVER_INTERNAL.test(text)) return;
        logger.debug({ requestId: currentScope()?.requestId, sql: text }, '  └─ SQL');
      },
    }),
  );
}

/** Consulta de tipos que postgres.js hace sola al abrir cada conexión. No es nuestra. */
const DRIVER_INTERNAL = /^\s*select b\.oid, b\.typarray from pg_catalog\.pg_type/;

function compact(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 220);
}

type Client = ReturnType<typeof postgres>;

/**
 * Cuenta cada consulta en la operación que la pidió.
 *
 * postgres.js ejecuta una consulta la primera vez que alguien la espera (`await`,
 * `.then`, `.execute`), y en todos esos casos pasa por `handle()`. Ese instante ocurre
 * dentro del request que la pidió, así que `currentScope()` es el correcto. Los
 * fragmentos que se interpolan dentro de otra consulta nunca se esperan: no suman.
 *
 * Las transacciones (`sql.begin`) reciben su propio cliente `tx`, que se instrumenta igual.
 */
function instrument<T extends Client>(client: T): T {
  return new Proxy(client, {
    apply(target, thisArg, args) {
      return countOnRun(Reflect.apply(target, thisArg, args));
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'unsafe') {
        return (...args: unknown[]) => countOnRun(value.apply(target, args));
      }
      if (prop === 'begin') {
        return (...args: unknown[]) => {
          const callback = args[args.length - 1] as (tx: Client) => unknown;
          args[args.length - 1] = (tx: Client) => callback(instrument(tx));
          return value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}

function countOnRun<Q>(query: Q): Q {
  const q = query as { handle?: () => unknown; executed?: boolean };
  if (typeof q?.handle !== 'function') return query; // helpers como sql(ids): no son consultas
  const handle = q.handle;
  q.handle = function (this: typeof q) {
    if (!this.executed) {
      const scope = currentScope();
      if (scope) scope.sqlCount += 1;
    }
    return handle.call(this);
  };
  return query;
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
 * Va aparte, contra `DIRECT_URL`, porque LISTEN necesita una conexión propia que quede
 * abierta mientras dure la suscripción, sin mezclarse con las consultas de los requests.
 */
export function listenerDb(): Sql {
  if (!globalForDb.__afirmativePillListener) {
    const url = process.env.DIRECT_URL ?? connectionString();
    globalForDb.__afirmativePillListener = createClient(url, 1);
  }
  return globalForDb.__afirmativePillListener;
}

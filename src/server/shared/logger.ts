import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Logger del servidor GraphQL.
 *
 * En desarrollo sale en una línea legible por humanos, porque uno de los entregables del
 * taller es *mostrar en los logs* cómo el DataLoader agrupa las consultas a Supabase.
 * En producción sale como JSON, que es lo que `vercel logs` sabe indexar.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: undefined,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            messageFormat: '{msg}',
          },
        },
      }
    : {}),
});

import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import {
  DateResolver,
  DateTimeResolver,
  NonEmptyStringResolver,
  PositiveIntResolver,
  URLResolver,
} from 'graphql-scalars';

/**
 * Money — pesos colombianos, sin decimales.
 *
 * La base de datos guarda `numeric(12,2)` y postgres.js lo entrega como string para no
 * perder precisión. Este scalar es el único punto donde ese string se convierte en
 * número, y de paso rechaza negativos: un precio o un total negativo nunca puede salir
 * ni entrar por el contrato.
 */
export const MoneyResolver = new GraphQLScalarType<number, number>({
  name: 'Money',
  description: 'Importe en pesos colombianos (COP), entero no negativo. 46000 = $46.000.',

  serialize(value) {
    const amount = typeof value === 'string' ? Number(value) : (value as number);
    if (!Number.isFinite(amount)) {
      throw new GraphQLError(`Money no puede serializar el valor ${String(value)}.`);
    }
    return Math.round(amount);
  },

  parseValue(value) {
    const amount = typeof value === 'string' ? Number(value) : (value as number);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new GraphQLError('Money debe ser un número no negativo.');
    }
    return Math.round(amount);
  },

  parseLiteral(node) {
    if (node.kind !== Kind.INT && node.kind !== Kind.FLOAT) {
      throw new GraphQLError('Money debe escribirse como número literal.');
    }
    const amount = Number(node.value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new GraphQLError('Money debe ser un número no negativo.');
    }
    return Math.round(amount);
  },
});

export const scalarResolvers = {
  DateTime: DateTimeResolver,
  Date: DateResolver,
  Money: MoneyResolver,
  PositiveInt: PositiveIntResolver,
  NonEmptyString: NonEmptyStringResolver,
  URL: URLResolver,
};

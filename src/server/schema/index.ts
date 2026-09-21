import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './typeDefs.generated';
import { scalarResolvers } from './scalars';
import { queryResolvers } from '@/server/query-side/resolvers';
import { commandResolvers } from '@/server/command-side/resolvers';
import { subscriptionResolvers } from '@/server/subscriptions/order-status';

/**
 * Ensamblado del schema ejecutable.
 *
 * El mapa de resolvers se compone de tres piezas que corresponden una a una con la
 * arquitectura: lectura (`query-side`), escritura (`command-side`) y notificación
 * (`subscriptions`). `Query` aparece en dos de ellas — casi todo en el read side, y
 * `Query.cart` en el write side — así que se fusionan explícitamente en lugar de dejar
 * que un spread silencioso descarte la mitad.
 */

const resolvers = {
  ...scalarResolvers,

  Query: {
    ...queryResolvers.Query,
    ...commandResolvers.Query,
  },
  Mutation: commandResolvers.Mutation,
  Subscription: subscriptionResolvers.Subscription,

  // read side
  MedicationConnection: queryResolvers.MedicationConnection,
  MedicationFacets: queryResolvers.MedicationFacets,
  CategoryFacet: queryResolvers.CategoryFacet,
  Medication: queryResolvers.Medication,
  MedicationSummary: queryResolvers.MedicationSummary,
  Category: queryResolvers.Category,
  Laboratory: queryResolvers.Laboratory,
  OrderProjection: queryResolvers.OrderProjection,
  OrderItemProjection: queryResolvers.OrderItemProjection,

  // write side
  Cart: commandResolvers.Cart,
  CartItem: commandResolvers.CartItem,
  CommandError: commandResolvers.CommandError,
  PrescriptionRequiredError: commandResolvers.PrescriptionRequiredError,
};

/**
 * Un único `GraphQLSchema` para los dos transportes: el handler HTTP de Apollo Server y
 * el handler SSE de las subscriptions. Mismo contrato, mismo endpoint, dos protocolos.
 */
export const schema = makeExecutableSchema({ typeDefs, resolvers });

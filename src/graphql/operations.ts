import { gql } from '@apollo/client';

/**
 * ============================================================================
 *  Operaciones GraphQL del cliente
 * ============================================================================
 *
 * Todas las operaciones de la aplicación viven acá, en un solo lugar, para que se pueda
 * auditar de un vistazo qué le pide el frontend al servidor.
 *
 * Fíjate en el contraste entre `CatalogMedications` y `MedicationDetail`: la grilla pide
 * 7 campos por medicamento; la ficha pide la descripción, el laboratorio, el principio
 * activo y las alternativas. Es el mismo endpoint y el mismo tipo, pero el listado NUNCA
 * descarga la ficha clínica. Eso es exactamente lo que se va a mostrar en la pestaña
 * Network durante la sustentación: la respuesta trae lo pedido y nada más.
 */

// --------------------------------------------------------------------- fragmentos

export const MEDICATION_SUMMARY_FIELDS = gql`
  fragment MedicationSummaryFields on MedicationSummary {
    id
    sku
    name
    dosage
    presentation
    price
    requiresPrescription
    inStock
    category {
      id
      name
    }
  }
`;

export const ORDER_PROJECTION_FIELDS = gql`
  fragment OrderProjectionFields on OrderProjection {
    id
    status
    total
    requiresPrescription
    prescriptionStatus
    cancellationReason
    placedAt
    updatedAt
    freshness
    version
    items {
      medicationId
      name
      quantity
      unitPrice
      lineTotal
    }
  }
`;

/** Los errores de comando se leen igual en las cuatro pantallas. */
export const COMMAND_ERROR_FIELDS = gql`
  fragment CommandErrorFields on CommandError {
    code
    message
    ... on OutOfStockError {
      medicationId
      medicationName
      requested
      available
    }
    ... on PrescriptionRequiredError {
      medications {
        id
        name
      }
    }
    ... on ValidationError {
      field
    }
    ... on InvalidStateError {
      currentStatus
      attemptedTransition
    }
    ... on NotFoundError {
      resource
      id
    }
  }
`;

// --------------------------------------------------------------------- Escenario A

/** Grilla del catálogo: vista condensada + facetas. Nada de información clínica. */
export const CATALOG_MEDICATIONS = gql`
  ${MEDICATION_SUMMARY_FIELDS}
  query CatalogMedications(
    $filter: MedicationFilter
    $sort: MedicationSort
    $first: Int
    $after: String
  ) {
    medications(filter: $filter, sort: $sort, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ...MedicationSummaryFields
        }
      }
      facets {
        requiresPrescription {
          withPrescription
          overTheCounter
        }
        categories {
          count
          category {
            id
            name
            slug
          }
        }
      }
    }
  }
`;

export const CATEGORIES = gql`
  query Categories {
    categories {
      id
      name
      slug
      medicationCount
    }
  }
`;

/**
 * Ficha detallada. Los tres campos anidados (`activeIngredient`, `laboratory`,
 * `category`) más `relatedMedications` son los que dispararían el N+1 en el servidor:
 * acá se ve el lado del cliente de esa historia.
 */
export const MEDICATION_DETAIL = gql`
  ${MEDICATION_SUMMARY_FIELDS}
  query MedicationDetail($id: ID!) {
    medication(id: $id) {
      id
      sku
      name
      dosage
      presentation
      price
      stock
      inStock
      requiresPrescription
      description
      activeIngredient {
        id
        name
      }
      laboratory {
        id
        name
      }
      category {
        id
        name
        slug
      }
      relatedMedications(first: 4) {
        ...MedicationSummaryFields
      }
    }
  }
`;

// --------------------------------------------------------------------- Escenario B

export const CART = gql`
  ${MEDICATION_SUMMARY_FIELDS}
  query Cart($id: ID!) {
    cart(id: $id) {
      id
      patientId
      status
      subtotal
      requiresPrescription
      updatedAt
      prescription {
        id
        doctorName
        medicalLicense
        issuedAt
        status
      }
      items {
        quantity
        unitPrice
        lineTotal
        medication {
          ...MedicationSummaryFields
        }
      }
    }
  }
`;

export const CREATE_CART = gql`
  ${COMMAND_ERROR_FIELDS}
  mutation CreateCart($patientId: ID!) {
    createCart(patientId: $patientId) {
      cart {
        id
        status
        subtotal
        requiresPrescription
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

export const ADD_MEDICATION_TO_CART = gql`
  ${MEDICATION_SUMMARY_FIELDS}
  ${COMMAND_ERROR_FIELDS}
  mutation AddMedicationToCart($input: AddMedicationToCartInput!) {
    addMedicationToCart(input: $input) {
      cart {
        id
        subtotal
        requiresPrescription
        items {
          quantity
          unitPrice
          lineTotal
          medication {
            ...MedicationSummaryFields
          }
        }
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

export const REMOVE_MEDICATION_FROM_CART = gql`
  ${MEDICATION_SUMMARY_FIELDS}
  ${COMMAND_ERROR_FIELDS}
  mutation RemoveMedicationFromCart($input: RemoveMedicationFromCartInput!) {
    removeMedicationFromCart(input: $input) {
      cart {
        id
        subtotal
        requiresPrescription
        items {
          quantity
          unitPrice
          lineTotal
          medication {
            ...MedicationSummaryFields
          }
        }
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

export const ATTACH_PRESCRIPTION = gql`
  ${COMMAND_ERROR_FIELDS}
  mutation AttachPrescriptionToCart($input: AttachPrescriptionInput!) {
    attachPrescriptionToCart(input: $input) {
      cart {
        id
        requiresPrescription
        prescription {
          id
          doctorName
          medicalLicense
          issuedAt
          status
        }
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

export const PLACE_ORDER = gql`
  ${ORDER_PROJECTION_FIELDS}
  ${COMMAND_ERROR_FIELDS}
  mutation PlaceOrder($input: PlaceOrderInput!) {
    placeOrder(input: $input) {
      order {
        ...OrderProjectionFields
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

// --------------------------------------------------------------------- Escenario C

export const ORDER = gql`
  ${ORDER_PROJECTION_FIELDS}
  query Order($id: ID!) {
    order(id: $id) {
      ...OrderProjectionFields
    }
  }
`;

export const ORDERS = gql`
  ${ORDER_PROJECTION_FIELDS}
  query Orders($patientId: ID!) {
    orders(patientId: $patientId) {
      ...OrderProjectionFields
    }
  }
`;

/** Tiempo real: el servidor empuja la proyección cada vez que el projector la actualiza. */
export const ORDER_STATUS_CHANGED = gql`
  ${ORDER_PROJECTION_FIELDS}
  subscription OrderStatusChanged($orderId: ID!) {
    orderStatusChanged(orderId: $orderId) {
      ...OrderProjectionFields
    }
  }
`;

export const APPROVE_ORDER = gql`
  ${ORDER_PROJECTION_FIELDS}
  ${COMMAND_ERROR_FIELDS}
  mutation ApproveOrder($orderId: ID!) {
    approveOrder(orderId: $orderId) {
      order {
        ...OrderProjectionFields
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

export const DISPATCH_ORDER = gql`
  ${ORDER_PROJECTION_FIELDS}
  ${COMMAND_ERROR_FIELDS}
  mutation DispatchOrder($orderId: ID!) {
    dispatchOrder(orderId: $orderId) {
      order {
        ...OrderProjectionFields
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

export const CANCEL_ORDER = gql`
  ${ORDER_PROJECTION_FIELDS}
  ${COMMAND_ERROR_FIELDS}
  mutation CancelOrder($orderId: ID!, $reason: NonEmptyString!) {
    cancelOrder(orderId: $orderId, reason: $reason) {
      order {
        ...OrderProjectionFields
      }
      errors {
        ...CommandErrorFields
      }
    }
  }
`;

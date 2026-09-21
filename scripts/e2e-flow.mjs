#!/usr/bin/env node
/**
 * Recorrido de punta a punta del dominio, contra un servidor ya levantado.
 *
 *     npm run dev            # en otra terminal
 *     node scripts/e2e-flow.mjs
 *
 * Ejercita los tres escenarios del taller y, sobre todo, verifica las dos invariantes
 * farmacéuticas contra la base de datos real — no contra mocks:
 *
 *   1. un pedido con medicamento de control NO se emite sin fórmula médica;
 *   2. el stock se descuenta de forma atómica y no se puede sobrevender.
 *
 * Todo cursa por POST /graphql. No hay un solo llamado REST en este archivo, igual que
 * en el frontend.
 */

const ENDPOINT = process.env.GRAPHQL_ENDPOINT ?? 'http://localhost:3000/graphql';

let step = 0;
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const info = (msg) => console.log(`    ${msg}`);
const title = (msg) => console.log(`\n\x1b[1m${++step}. ${msg}\x1b[0m`);
const fail = (msg) => {
  console.error(`  \x1b[31m✗ ${msg}\x1b[0m`);
  process.exitCode = 1;
};

async function gql(query, variables = {}, operationName) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables, operationName }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors, null, 2));
  return body.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const patientId = `e2e-${Date.now()}`;

// ---------------------------------------------------------------- Escenario A
title('Catálogo: busco un medicamento de venta libre y uno de control');

const { otc, rx } = await gql(`
  query DosMedicamentos {
    otc: medications(first: 1, filter: { requiresPrescription: false, onlyInStock: true }) {
      edges { node { id name price requiresPrescription category { name } } }
    }
    rx: medications(first: 1, filter: { requiresPrescription: true, onlyInStock: true }) {
      edges { node { id name price requiresPrescription category { name } } }
    }
  }
`);

const libre = otc.edges[0].node;
const control = rx.edges[0].node;
ok(`venta libre: ${libre.name} (${libre.category.name})`);
ok(`bajo fórmula: ${control.name} (${control.category.name})`);

// ---------------------------------------------------------------- Escenario B
title('Comando createCart');
const { createCart } = await gql(
  `mutation ($p: ID!) { createCart(patientId: $p) { cart { id status } errors { code } } }`,
  { p: patientId },
);
const cartId = createCart.cart.id;
ok(`carrito ${cartId} abierto para ${patientId}`);

title('Comando addMedicationToCart (x2)');
for (const [medication, quantity] of [
  [libre, 2],
  [control, 1],
]) {
  const { addMedicationToCart } = await gql(
    `mutation ($i: AddMedicationToCartInput!) {
       addMedicationToCart(input: $i) {
         cart { id subtotal requiresPrescription }
         errors { code message }
       }
     }`,
    { i: { cartId, medicationId: medication.id, quantity } },
  );
  if (addMedicationToCart.errors.length) {
    fail(`${medication.name}: ${addMedicationToCart.errors[0].message}`);
  } else {
    ok(`${quantity} × ${medication.name} — subtotal ${addMedicationToCart.cart.subtotal}`);
  }
}

title('INVARIANTE 1 — placeOrder SIN fórmula médica debe ser rechazado');
const rechazo = await gql(
  `mutation ($i: PlaceOrderInput!) {
     placeOrder(input: $i) {
       order { id }
       errors {
         code message
         ... on PrescriptionRequiredError { medications { id name } }
       }
     }
   }`,
  { i: { cartId, idempotencyKey: `${patientId}-intento-1` } },
);

if (rechazo.placeOrder.order) {
  fail('¡se emitió el pedido sin fórmula médica! La invariante está rota.');
} else {
  const error = rechazo.placeOrder.errors[0];
  ok(`rechazado con ${error.code}`);
  info(`"${error.message}"`);
  info(`medicamentos señalados: ${error.medications.map((m) => m.name).join(', ')}`);
}

title('Comando attachPrescriptionToCart');
const { attachPrescriptionToCart } = await gql(
  `mutation ($i: AttachPrescriptionInput!) {
     attachPrescriptionToCart(input: $i) {
       cart { prescription { id status doctorName } }
       errors { code message }
     }
   }`,
  {
    i: {
      cartId,
      prescription: {
        doctorName: 'Dra. Ana Restrepo',
        medicalLicense: 'RM-48213',
        issuedAt: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        documentUrl: 'https://ejemplo.test/formula-medica.pdf',
      },
    },
  },
);
if (attachPrescriptionToCart.errors.length) {
  fail(attachPrescriptionToCart.errors[0].message);
} else {
  ok(`fórmula adjunta — estado ${attachPrescriptionToCart.cart.prescription.status}`);
}

title('Comando placeOrder CON fórmula médica');
const emision = await gql(
  `mutation ($i: PlaceOrderInput!) {
     placeOrder(input: $i) {
       order { id status total freshness version items { name quantity lineTotal } }
       errors { code message }
     }
   }`,
  { i: { cartId, idempotencyKey: `${patientId}-intento-2` } },
);

if (!emision.placeOrder.order) {
  fail(`no se emitió: ${JSON.stringify(emision.placeOrder.errors)}`);
  process.exit(1);
}

const orderId = emision.placeOrder.order.id;
ok(`orden ${orderId} emitida — total ${emision.placeOrder.order.total}`);
info(`estado ${emision.placeOrder.order.status}, freshness ${emision.placeOrder.order.freshness}`);

// ---------------------------------------------------------------- Escenario C
title('Consistencia eventual: leo la proyección antes y después del projector');

const antes = await gql(
  `query ($id: ID!) { order(id: $id) { freshness version status } }`,
  { id: orderId },
);
info(`inmediatamente después del comando: freshness=${antes.order.freshness} version=${antes.order.version}`);

await sleep(2500);

const despues = await gql(
  `query ($id: ID!) { order(id: $id) { freshness version status total items { name quantity } } }`,
  { id: orderId },
);
if (despues.order.freshness === 'UP_TO_DATE') {
  ok(`la proyección alcanzó al comando: freshness=UP_TO_DATE version=${despues.order.version}`);
} else {
  fail(`la proyección sigue en ${despues.order.freshness} tras 2.5 s`);
}

title('Comando approveOrder (back-office)');
const { approveOrder } = await gql(
  `mutation ($id: ID!) { approveOrder(orderId: $id) { order { status prescriptionStatus } errors { code message } } }`,
  { id: orderId },
);
if (approveOrder.errors.length) fail(approveOrder.errors[0].message);
else ok(`orden aprobada — receta ${approveOrder.order.prescriptionStatus}`);

title('INVARIANTE del ciclo de vida — no se puede aprobar dos veces');
const doble = await gql(
  `mutation ($id: ID!) { approveOrder(orderId: $id) { order { id } errors { code message ... on InvalidStateError { currentStatus attemptedTransition } } } }`,
  { id: orderId },
);
if (doble.approveOrder.order) fail('la transición ilegal fue aceptada');
else {
  const error = doble.approveOrder.errors[0];
  ok(`rechazado con ${error.code} (${error.currentStatus} → ${error.attemptedTransition})`);
}

title('INVARIANTE 2 — sobreventa de inventario');
const { medication } = await gql(
  `query ($id: ID!) { medication(id: $id) { id name stock } }`,
  { id: libre.id },
);
info(`stock actual de ${medication.name}: ${medication.stock}`);

const { createCart: carritoAvaro } = await gql(
  `mutation ($p: ID!) { createCart(patientId: $p) { cart { id } errors { code } } }`,
  { p: `${patientId}-avaro` },
);
const { addMedicationToCart: agregado } = await gql(
  `mutation ($i: AddMedicationToCartInput!) {
     addMedicationToCart(input: $i) { cart { id } errors { code message } }
   }`,
  { i: { cartId: carritoAvaro.cart.id, medicationId: medication.id, quantity: medication.stock + 50 } },
);
if (agregado.errors.length) info(`(el carrito avisó: ${agregado.errors[0].code})`);

const sobreventa = await gql(
  `mutation ($i: PlaceOrderInput!) {
     placeOrder(input: $i) {
       order { id }
       errors { code message ... on OutOfStockError { requested available medicationName } }
     }
   }`,
  { i: { cartId: carritoAvaro.cart.id, idempotencyKey: `${patientId}-sobreventa` } },
);
if (sobreventa.placeOrder.order) {
  fail('¡se vendió inventario inexistente!');
} else {
  const error = sobreventa.placeOrder.errors[0];
  ok(`rechazado con ${error.code}`);
  info(`pidió ${error.requested}, había ${error.available} de ${error.medicationName}`);
}

title('Idempotencia — reenviar el mismo comando no duplica la orden');
const reintento = await gql(
  `mutation ($i: PlaceOrderInput!) { placeOrder(input: $i) { order { id } errors { code } } }`,
  { i: { cartId, idempotencyKey: `${patientId}-intento-2` } },
);
if (reintento.placeOrder.order?.id === orderId) {
  ok(`devolvió la MISMA orden ${orderId}, no creó una nueva`);
} else {
  fail(`devolvió ${JSON.stringify(reintento.placeOrder)}`);
}

console.log(
  process.exitCode
    ? '\n\x1b[31mHubo fallos.\x1b[0m\n'
    : '\n\x1b[32mFlujo completo verificado contra la base real.\x1b[0m\n',
);

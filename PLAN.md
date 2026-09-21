# PLAN DE TRABAJO — Afirmative Pill

Plan de implementación para el taller *"Arquitectura de Software Basada en GraphQL y CQRS para E-Commerce
Farmacéutico"*. El enunciado íntegro está registrado en [`docs/ENUNCIADO.md`](docs/ENUNCIADO.md); este documento
define **cómo** lo vamos a resolver.

- **Fecha de creación del plan**: 2026-09-20
- **Estado**: repositorio vacío, rama `main` sin commits.
- **Calificación objetivo**: 5.0 / 5.0 (cubrir los 4 criterios de la rúbrica al 100%).
- **Infraestructura confirmada**: despliegue en **Vercel**, base de datos en **Supabase**
  (`project_ref = wcmiyijouostqxrusqrd`, MCP del proyecto ya configurado en `.mcp.json`).

---

## 1. Decisiones de arquitectura (ADR resumidos)

| # | Decisión | Alternativa descartada | Justificación |
|---|---|---|---|
| ADR-1 | **Monolito modular** con Apollo Server 4 (`@apollo/server`) montado como **Route Handler de Next.js en `app/graphql/route.ts`** vía `@as-integrations/next` | Federación (Gateway/Router + subgraphs); Express separado | El enunciado permite monolito modular. Un solo despliegue en Vercel, un solo endpoint `/graphql` (sin `/api/`, lo que refuerza la evidencia Zero-REST en DevTools). La segregación por *bounded context* vive en `src/server/` (`catalog/`, `ordering/`) y puede extraerse a subgraphs después; la ruta de migración a federación se documenta en el README. |
| ADR-2 | **TypeScript** en backend y frontend | JavaScript | Los tipos generados desde el SDL (`graphql-codegen`) demuestran rigor de contrato, que es el 40% de la nota. |
| ADR-3 | **Next.js 15 (App Router) + Apollo Client 3.x** | CRA / Vite | El enunciado pide React/Next.js. App Router con `ApolloProvider` en un `providers.tsx` `"use client"` montado en `app/layout.tsx` = "árbol de contexto de Apollo" explícito. |
| ADR-4 | **Supabase PostgreSQL** accedido con el driver `postgres` (postgres.js) mediante la *connection string* del **pooler en modo transacción (puerto 6543)**, no con `supabase-js` | `@supabase/supabase-js` (PostgREST) | `supabase-js` habla PostgREST (REST) por debajo y complica demostrar SQL en lote + transacciones reales. Con SQL directo: `WHERE id = ANY($1)` para DataLoader y `BEGIN/COMMIT` para el comando de compra. El pooler es obligatorio en funciones serverless (conexiones efímeras). **Zero-REST**: la restricción aplica al canal *cliente↔servidor*, pero usar SQL evita cualquier discusión en la sustentación. |
| ADR-5 | **Subscriptions con `graphql-sse`** sobre el mismo endpoint `/graphql` | `graphql-ws` (WebSockets) | Vercel Functions ya soportan WebSockets sobre Fluid Compute, pero requieren la API experimental de upgrade y son frágiles de demostrar. SSE es nativo en Fluid Compute, va por el **mismo `/graphql`** (evidencia Zero-REST intacta: `text/event-stream` en DevTools) y Apollo Client lo consume con un link propio. Se conserva el mismo contrato `type Subscription` del SDL. |
| ADR-6 | **CQRS sin Event Sourcing completo**: tablas de escritura normalizadas + tabla de eventos de dominio (outbox) + **tablas de proyección** desnormalizadas actualizadas por un *projector* disparado con `waitUntil()` | Event Sourcing puro; worker con poll permanente | El taller evalúa la *segregación* y el manejo de consistencia eventual, no el event store. En serverless no hay proceso residente: el handler hace commit, responde, y `waitUntil()` (de `@vercel/functions`) drena el outbox **después** de la respuesta → consistencia eventual real y observable, sin costo de event store. Red de seguridad: drenado perezoso al leer la proyección. |
| ADR-7 | **Una sola app Next.js** con `src/app/` (frontend) y `src/server/` (backend GraphQL) claramente separados | npm workspaces `server/` + `web/`; dos despliegues | Vercel despliega un solo proyecto; sin CORS, sin dos URLs, sin variables duplicadas. La separación frontend/backend se mantiene **explícita por carpetas** y se explica en el README y el diagrama. |
| ADR-8 | **Despliegue en Vercel** (Fluid Compute, Node.js runtime) + Supabase como base gestionada | Render / Fly / local | Decisión del equipo. Da URL pública para la sustentación y previews por PR. Nunca `runtime = 'edge'`: se necesita el driver TCP de Postgres. |

---

## 2. Stack técnico

**Backend (`src/server/`, servido en `/graphql`)**
- `@apollo/server` 4 + `@as-integrations/next`
- `graphql`, `graphql-sse`, `graphql-subscriptions` (PubSub) — ver nota de PubSub en §6.3
- `dataloader`
- `postgres` (postgres.js) → Supabase Postgres vía pooler en modo transacción
- `graphql-scalars` + scalars propios (`DateTime`, `Money`, `PositiveInt`, `UUID`, `NonEmptyString`)
- `zod` para validación de inputs de comando
- `pino` para logs (clave para la evidencia de DataLoader en el video y en `vercel logs`)
- `@vercel/functions` (`waitUntil`) para el projector post-respuesta
- `vitest` para pruebas de invariantes y anti-N+1

**Frontend (`src/app/`)**
- Next.js 15 App Router, React 19, TypeScript
- `@apollo/client` + link SSE de `graphql-sse` (split: `subscription` → SSE, resto → HttpLink a `/graphql`)
- Tailwind CSS v4 + shadcn/ui (UI rápida y presentable)
- `@graphql-codegen/*` → hooks y tipos tipados desde el SDL
- **Dirección de diseño**: skills de `Leonxlnx/taste-skill` instaladas en `.agents/skills/`
  (`design-taste-frontend`, `minimalist-ui`, `high-end-visual-design`, …) para que la UI no se vea
  templated/genérica. Ver nota de alcance en §8.

**Infra**
- **Vercel**: proyecto único, Fluid Compute, runtime Node.js (nunca Edge: se usa TCP a Postgres)
- **Supabase** (`project_ref = wcmiyijouostqxrusqrd`): PostgreSQL + migraciones versionadas en `db/`
- MCP de Supabase ya registrado en `.mcp.json` (autenticar con `/mcp` antes de usarlo)
- Variables: `DATABASE_URL` (pooler 6543), `DIRECT_URL` (5432, solo migraciones), `PROJECTION_DELAY_MS`.
  Gestionadas con `vercel env` y sincronizadas localmente con `vercel env pull`; `.env*` fuera del repo,
  `.env.example` documentado.

---

## 3. Estructura de carpetas objetivo

```
AFIRMATIVE-PILL/
├── README.md                     # entregable principal (diagrama, SDL, justificación CQRS/N+1)
├── PLAN.md                       # este documento
├── vercel.ts                     # configuración del proyecto (framework, headers, runtime)
├── .mcp.json                     # MCP de Supabase (ya creado)
├── docs/
│   ├── ENUNCIADO.md              # enunciado registrado
│   ├── arquitectura.md           # diagrama + explicación extendida
│   ├── cqrs.md                   # comandos, eventos, proyecciones, consistencia eventual
│   └── evidencias/               # capturas DevTools + logs para la sustentación
├── db/
│   ├── migrations/
│   │   ├── 001_catalog.sql       # laboratorios, categorías, principios activos, medicamentos
│   │   ├── 002_ordering.sql      # write model: orders, order_items, prescriptions, stock_reservations
│   │   ├── 003_events.sql        # domain_events (outbox)
│   │   ├── 004_projections.sql   # read model: medication_catalog_projection, order_projection
│   │   └── 005_indexes.sql       # índices + extensión pg_trgm para búsqueda
│   ├── functions/
│   │   └── place_order.sql       # función PL/pgSQL transaccional (reserva atómica de stock)
│   └── seed/
│       ├── medications.csv       # dataset de 50 medicamentos del docente
│       └── seed.ts               # cargador idempotente
└── src/
    ├── app/                                  # ===== FRONTEND =====
    │   ├── layout.tsx                        # <ApolloWrapper> en el árbol raíz
    │   ├── page.tsx                          # catálogo (vista condensada)
    │   ├── medicamentos/[id]/page.tsx        # ficha detallada
    │   ├── carrito/page.tsx
    │   ├── ordenes/[id]/page.tsx             # proyección + subscription
    │   └── graphql/route.ts                  # ===== ÚNICO ENDPOINT DE RED: /graphql =====
    ├── lib/apollo/                           # makeClient, split link, typePolicies, ApolloWrapper "use client"
    ├── graphql/                              # documentos .graphql del cliente + hooks generados
    └── server/                               # ===== BACKEND =====
        ├── apollo.ts                         # instancia de Apollo Server (singleton entre invocaciones)
        ├── context.ts                        # construye los DataLoaders POR REQUEST
        ├── schema/
        │   ├── schema.graphql                # SDL completo (entregable)
        │   ├── catalog.graphql
        │   ├── ordering.graphql
        │   └── scalars.graphql
        ├── loaders/                          # medicationById, categoriesByMedicationId, labById, itemsByOrderId...
        ├── query-side/                       # READ MODEL
        │   ├── resolvers/
        │   └── read-repositories/            # solo SELECT sobre proyecciones
        ├── command-side/                     # WRITE MODEL
        │   ├── commands/                     # CreateCart, AddItemToCart, AttachPrescription, PlaceOrder...
        │   ├── handlers/                     # validación de invariantes + transacción
        │   ├── domain/                       # entidades, value objects, errores de dominio tipados
        │   └── resolvers/
        ├── projections/                      # projector: domain_events → read model → notificación SSE
        └── shared/                           # db (pooler), pubsub, logger, errores
```

> **Nota de sustentación**: aunque es un solo proyecto desplegable, `src/app/` (cliente React) y `src/server/`
> (Apollo Server) están estrictamente separados; la única superficie de contacto es `src/app/graphql/route.ts`.
> El diagrama del README lo muestra como dos bloques distintos, igual que si fueran dos servicios.

---

## 4. Modelo de datos

### 4.1. Write model (normalizado, fuente de verdad)
- `laboratories(id, name, country)`
- `active_ingredients(id, name)`
- `categories(id, name, slug)` — categoría terapéutica
- `medications(id, commercial_name, active_ingredient_id, laboratory_id, presentation, price_cents,
  stock, requires_prescription, indications, contraindications, created_at, updated_at)`
- `medication_categories(medication_id, category_id)` — N:M (fuente natural del N+1)
- `carts(id, patient_id, status)` / `cart_items(cart_id, medication_id, quantity)`
- `prescriptions(id, order_id, doctor_name, medical_license, issued_at, document_url, status)`
- `orders(id, patient_id, status, total_cents, created_at, version)`
- `order_items(order_id, medication_id, quantity, unit_price_cents)`
- `stock_reservations(id, order_id, medication_id, quantity, released_at)`
- `domain_events(id, aggregate_type, aggregate_id, type, payload jsonb, occurred_at, processed_at)` ← outbox

### 4.2. Read model (proyecciones desnormalizadas, solo lectura)
- `medication_catalog_projection` — nombre comercial, principio activo, laboratorio, presentación, precio,
  `in_stock`, `requires_prescription`, `categories text[]`, `search_vector tsvector`.
  Sirve el Escenario A completo con **una sola query** + filtros facetados.
- `order_projection` — `order_id, patient_id, status, total_cents, items jsonb, prescription_status,
  projection_version, updated_at`.
  Sirve el Escenario C sin tocar el write model.

### 4.3. Índices
- `GIN` sobre `search_vector` y `pg_trgm` sobre `commercial_name` (búsqueda por nombre/principio activo).
- B-tree sobre `medications(laboratory_id)`, `medication_categories(medication_id)`, `order_items(order_id)`
  → exactamente las columnas que consultan los DataLoaders con `= ANY($1)`.

---

## 5. Diseño del Schema SDL (borrador de contrato)

Contrato objetivo, a afinar en la Fase 2. Refleja los cuatro pilares de la rúbrica: scalars propios, enums,
inputs, **payloads tipados con errores de validación**.

```graphql
scalar DateTime
scalar UUID
scalar Money          # entero en centavos, serializado con formato
scalar PositiveInt

enum OrderStatus { PENDING_APPROVAL APPROVED DISPATCHED CANCELLED }
enum PrescriptionStatus { NOT_REQUIRED PENDING_VALIDATION VALIDATED REJECTED }
enum ProjectionFreshness { UP_TO_DATE SYNCING }   # <- consistencia eventual explícita en el contrato
enum MedicationSortField { PRICE NAME RELEVANCE }

# ---------- Read model ----------
type MedicationSummary {          # vista condensada: Escenario A (anti over-fetching)
  id: UUID!
  commercialName: String!
  presentation: String!
  price: Money!
  requiresPrescription: Boolean!
  inStock: Boolean!
}

type Medication {                 # ficha detallada
  id: UUID!
  commercialName: String!
  presentation: String!
  price: Money!
  stock: Int!
  requiresPrescription: Boolean!
  indications: String
  contraindications: String
  activeIngredient: ActiveIngredient!   # resuelto vía DataLoader
  laboratory: Laboratory!               # resuelto vía DataLoader
  categories: [Category!]!              # resuelto vía DataLoader (N:M, el N+1 clásico)
}

type MedicationConnection { edges: [MedicationEdge!]!, pageInfo: PageInfo!, totalCount: Int! }

input MedicationFilter {
  search: String
  activeIngredientIds: [UUID!]
  categoryIds: [UUID!]
  requiresPrescription: Boolean
  onlyInStock: Boolean
  maxPrice: Money
}

type OrderProjection {
  id: UUID!
  status: OrderStatus!
  total: Money!
  items: [OrderItemProjection!]!
  prescriptionStatus: PrescriptionStatus!
  freshness: ProjectionFreshness!       # el usuario sabe si está viendo un dato en sincronización
  placedAt: DateTime!
  updatedAt: DateTime!
}

type Query {
  medications(filter: MedicationFilter, sort: MedicationSortField, first: Int, after: String): MedicationConnection!
  medication(id: UUID!): Medication
  categories: [Category!]!
  order(id: UUID!): OrderProjection
  myOrders(patientId: UUID!): [OrderProjection!]!
}

# ---------- Write model (comandos con intención de negocio) ----------
input PrescriptionInput {
  doctorName: NonEmptyString!
  medicalLicense: NonEmptyString!
  issuedAt: DateTime!
  documentUrl: String!
}
input OrderLineInput { medicationId: UUID!, quantity: PositiveInt! }
input PlaceOrderInput {
  patientId: UUID!
  lines: [OrderLineInput!]!
  prescription: PrescriptionInput      # obligatoria si alguna línea requires_prescription
  idempotencyKey: String!
}

interface CommandError { code: String!, message: String! }
type OutOfStockError implements CommandError { code: String!, message: String!, medicationId: UUID!, available: Int! }
type PrescriptionRequiredError implements CommandError { code: String!, message: String!, medicationIds: [UUID!]! }
type ValidationError implements CommandError { code: String!, message: String!, field: String! }

type PlaceOrderPayload {
  order: OrderProjection          # proyección optimista, freshness: SYNCING
  errors: [CommandError!]!        # respuesta rica en errores de validación (rúbrica 1)
}

type Mutation {
  createCart(patientId: UUID!): CreateCartPayload!
  addMedicationToCart(input: AddMedicationToCartInput!): CartPayload!
  attachPrescriptionToCart(input: AttachPrescriptionInput!): CartPayload!
  placeOrder(input: PlaceOrderInput!): PlaceOrderPayload!
  approveOrder(orderId: UUID!): OrderPayload!      # simula back-office / validación farmacéutica
  dispatchOrder(orderId: UUID!): OrderPayload!
  cancelOrder(orderId: UUID!, reason: String!): OrderPayload!
}

type Subscription {
  orderStatusChanged(orderId: UUID!): OrderProjection!
}
```

**Nota de diseño**: los errores de negocio viajan en el payload (`errors: [CommandError!]!`), **no** como
`GraphQLError` de transporte. Esto es lo que se sustenta como "respuestas ricas en errores de validación".

---

## 6. Diseño CQRS

### 6.1. Camino de escritura (comando)
```
Mutation placeOrder
  → PlaceOrderCommand (DTO validado con zod)
  → PlaceOrderHandler
      ├─ carga medicamentos (write model, SELECT ... FOR UPDATE)
      ├─ INVARIANTE 1: si alguna línea requires_prescription y no hay PrescriptionInput → PrescriptionRequiredError
      ├─ INVARIANTE 2: stock >= quantity por línea → si no, OutOfStockError(available)
      ├─ BEGIN
      │    UPDATE medications SET stock = stock - $q WHERE id = $id AND stock >= $q   -- reserva atómica
      │    INSERT orders (status = PENDING_APPROVAL) + order_items + prescriptions + stock_reservations
      │    INSERT domain_events ('OrderPlaced')                                        -- outbox
      │  COMMIT
      └─ devuelve PlaceOrderPayload (proyección optimista, freshness = SYNCING)
```
Concurrencia: la condición `AND stock >= $q` dentro del `UPDATE` hace que dos compras simultáneas del último
ítem no puedan ganar ambas (`rowCount = 0` → `OutOfStockError`). **Esto se demuestra en el video con dos
pestañas disparando la mutación a la vez.**

Idempotencia: `idempotencyKey` con índice único → reintentos del cliente no duplican órdenes.

### 6.2. Camino de lectura (query)
Los resolvers de `Query` **jamás** tocan tablas del write model: solo `medication_catalog_projection` y
`order_projection`. Se hace cumplir por construcción: dos pools/repositorios distintos
(`read-repositories/` vs `command-side/`), y el repositorio de lectura solo expone métodos `SELECT`.

### 6.3. Projector y consistencia eventual (adaptado a serverless)
- Tras el `COMMIT`, el handler responde de inmediato y encola el trabajo con
  `waitUntil(projector.drain())` (`@vercel/functions`): el projector corre **después** de enviar la respuesta,
  dentro de la misma función Fluid.
- El projector lee `domain_events WHERE processed_at IS NULL`, escribe `order_projection`, marca el evento como
  procesado y notifica el cambio de estado.
- **Retardo deliberado y configurable** (`PROJECTION_DELAY_MS`, por defecto 1200 ms) para que la consistencia
  eventual sea *visible* en la sustentación, no un concepto teórico.
- **Red de seguridad**: al resolver `Query.order`, si existen eventos sin procesar para ese agregado se drenan
  antes de responder (nunca se queda una proyección huérfana si la función se congeló).
- **PubSub entre invocaciones**: la `PubSub` en memoria no sobrevive entre funciones serverless. La subscription
  SSE obtiene sus actualizaciones de un `asyncIterator` que escucha `LISTEN/NOTIFY` de Postgres
  (`NOTIFY order_changed, '<order_id>'` emitido por el projector) — un canal real, compatible con Supabase y
  con múltiples instancias. En desarrollo local se usa el mismo mecanismo, así que no hay divergencia dev/prod.

### 6.4. Qué ve el usuario mientras tanto (respuesta explícita del enunciado)
1. `placeOrder` devuelve de inmediato la proyección optimista con `freshness: SYNCING`.
2. El frontend escribe esa orden en la caché de Apollo y navega a `/ordenes/[id]`.
3. La UI muestra un banner *"Validando tu orden…"* mientras `freshness === SYNCING`.
4. La `Subscription` entrega el estado real (`PENDING_APPROVAL` → `APPROVED` → `DISPATCHED`) y la UI se
   actualiza reactivamente sin refetch, pasando a `UP_TO_DATE`.

---

## 7. Mitigación del problema N+1

Escenario que lo provoca: `medications(first: 20) { activeIngredient { name } laboratory { name } categories { name } }`
→ ingenuamente 1 + 20 + 20 + 20 = **61 queries**.

Solución: `context.ts` construye **DataLoaders nuevos en cada request** (caché por request, nunca global,
para no servir stock obsoleto):

| Loader | Query en lote |
|---|---|
| `medicationById` | `SELECT * FROM medications WHERE id = ANY($1)` |
| `laboratoryById` | `SELECT * FROM laboratories WHERE id = ANY($1)` |
| `activeIngredientById` | `SELECT * FROM active_ingredients WHERE id = ANY($1)` |
| `categoriesByMedicationId` | `SELECT mc.medication_id, c.* FROM medication_categories mc JOIN categories c ... WHERE mc.medication_id = ANY($1)` + regroup |
| `itemsByOrderId` | `SELECT * FROM order_items WHERE order_id = ANY($1)` |

Resultado: **61 → 4 queries**. Cada ejecución del batch emite un log
`[dataloader] batch loader=categoriesByMedicationId keys=20 sql=1` → esa es exactamente la evidencia que pide
el entregable del video. Se agrega una prueba con `vitest` que cuenta las queries ejecutadas y falla si superan
el umbral (regresión de N+1 detectable).

---

## 8. Frontend — Apollo Client

- `web/src/lib/apollo/ApolloWrapper.tsx` (`"use client"`) monta `<ApolloProvider client={makeClient()}>` dentro
  de `app/layout.tsx` → **árbol de contexto de Apollo en la raíz** (rúbrica 3).
- `split link`: link SSE (`graphql-sse`) para operaciones `subscription`, `HttpLink` a `/graphql` (ruta relativa,
  mismo origen — sin CORS ni URL de backend que configurar) para queries y mutations.
  **Ningún `fetch` a endpoints REST en toda la app** (se verifica con un test de grep en CI y en DevTools).
- `InMemoryCache` con `typePolicies`:
  - `Query.medications` → `relayStylePagination` por argumentos de filtro (paginación incremental).
  - `keyFields` por `id` en `Medication`/`OrderProjection` → normalización correcta.
- Hooks: `useQuery` (catálogo y ficha), `useMutation` con `update(cache, …)` para insertar la orden recién creada
  en `myOrders` sin refetch, y `useSuspenseQuery` donde aplique; `useSubscription` en la vista de orden.
- Estados `loading` / `error` / `data` renderizados explícitamente (skeletons + mensajes de error de dominio
  leídos desde `payload.errors`, distinguiendo `OutOfStockError` de `PrescriptionRequiredError`).
- Vistas:
  1. `/` catálogo con filtros facetados → pide **solo** `MedicationSummary` (evidencia anti over-fetching).
  2. `/medicamentos/[id]` ficha detallada → pide el resto de campos.
  3. `/carrito` con validación de receta en UI antes de habilitar el botón.
  4. `/ordenes/[id]` proyección + tiempo real.

### 8.1. Dirección visual (taste-skill)
Las skills de `Leonxlnx/taste-skill` guían la estética. Alcance real de cada una en este proyecto:

| Skill | Uso aquí |
|---|---|
| `design-taste-frontend` | **Design read** inicial, sistema de color/tipografía y la disciplina anti-defaults (nada de gradientes morados de IA, tres tarjetas iguales, Inter + slate-900). Su propio alcance declarado son landings y portfolios, **no** product UI multi-paso, así que se toma la dirección de diseño, no la estructura de página. |
| `minimalist-ui` / `high-end-visual-design` | Las pantallas de producto (catálogo, ficha, carrito, orden), que sí son UI densa y transaccional. |
| `imagegen-*`, `brandkit`, `image-to-code` | Fuera de alcance del taller; no se usan. |

**Design read propuesto**: *e-commerce farmacéutico regulado para pacientes → lenguaje trust-first,
clínico-editorial y altamente legible, con paleta sobria y contraste alto*. En salud la accesibilidad y la
claridad de la información clínica mandan sobre la experimentación visual (el propio `design-taste-frontend`
declara que las restricciones de industrias reguladas OVERRIDEAN la preferencia estética).

---

## 9. Fases de ejecución

| Fase | Entregable | Criterio de "hecho" |
|---|---|---|
| **F0 — Andamiaje** | App Next.js + TS, `src/server/`, `vercel.ts`, `.env.example`, `.gitignore`, commit inicial, `vercel link` | `npm run dev` sirve la web y `/graphql` responde `{ __typename }` |
| **F1 — Supabase + dataset** | Migraciones 001–005, `place_order.sql`, seed con los 50 medicamentos (aplicadas vía MCP de Supabase / `psql`) | `SELECT count(*) FROM medications` = 50; proyección de catálogo poblada |
| **F2 — Contrato SDL** | `schema.graphql` completo + codegen en ambos lados | El schema compila y `graphql-codegen` genera tipos sin errores |
| **F3 — Read side** | Resolvers de `Query` sobre proyecciones + los 5 DataLoaders + logs de batch | Query anidada de 20 medicamentos ejecuta ≤ 4 SQL (test automatizado) |
| **F4 — Write side** | Comandos, handlers, invariantes, transacción atómica, `domain_events` | Tests: sin receta → `PrescriptionRequiredError`; stock 1 con 2 compras concurrentes → una falla con `OutOfStockError` |
| **F5 — Projector + Subscriptions** | Projector con `waitUntil` + delay configurable, `LISTEN/NOTIFY`, `orderStatusChanged` vía SSE | Cambiar estado con `approveOrder` empuja el evento al cliente suscrito |
| **F6 — Frontend** | Las 4 vistas con ApolloProvider, hooks, cache updates, banner de `SYNCING`, bajo la dirección visual de §8.1 | Flujo completo catálogo → carrito → orden → tiempo real funcionando y con una UI que no parezca plantilla |
| **F7 — Despliegue en Vercel** | `vercel env` con `DATABASE_URL`/`DIRECT_URL`, deploy de preview y de producción | URL pública con el flujo completo y las subscriptions vivas; `vercel logs` muestra los batches del DataLoader |
| **F8 — Documentación** | `README.md` con diagrama (Mermaid), SDL, justificación CQRS y N+1, instrucciones de arranque y de despliegue | Un tercero clona y levanta el proyecto siguiendo solo el README |
| **F9 — Evidencias y video** | Capturas DevTools (`/graphql` únicamente + payload exacto), logs de DataLoader, guion del video de 5–8 min | Guion cronometrado en `docs/evidencias/guion-video.md` |

---

## 10. Trazabilidad con la rúbrica

| Criterio (peso) | Dónde se cubre | Evidencia para la sustentación |
|---|---|---|
| **GraphQL — 40%** | F2, F3, F4: SDL con scalars/enums/inputs/payloads; `MedicationSummary` vs `Medication`; errores tipados; DataLoaders | `schema.graphql`, DevTools ▸ Network (1 sola URL, payload exacto), logs de batch, test anti-N+1 |
| **CQRS — 25%** | F3, F4, F5: carpetas `query-side/` vs `command-side/`, invariantes, `domain_events` + projector con delay, `freshness` | `docs/cqrs.md`, demo de compra concurrente, banner "Validando tu orden…" en vivo |
| **Apollo Client — 20%** | F6: `ApolloWrapper` en layout raíz, `typePolicies`, `update()` de caché, `useSubscription` | Apollo DevTools mostrando la caché normalizada actualizándose sin refetch |
| **Supabase + calidad — 15%** | F1, F7: migraciones versionadas, índices GIN/trgm/B-tree, seed de 50 filas, README con diagrama | Tabla poblada en el dashboard de Supabase, `EXPLAIN ANALYZE` de la búsqueda usando el índice |

---

## 11. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Dataset de 50 medicamentos aún no descargado (link del docente) | Bloquea F1 | Seed provisional generado con datos realistas; se reemplaza por el CSV oficial apenas esté. El cargador lee CSV, así que el cambio es de datos, no de código. |
| Latencia de Supabase gratuito + cold start en la demo en vivo | Demo lenta en video | Pooler en modo transacción, cliente `postgres` reutilizado entre invocaciones (Fluid Compute mantiene la instancia viva) y precalentamiento antes de grabar. |
| Conexiones agotadas en Supabase por invocaciones serverless | Errores intermitentes en producción | Pooler (6543) + `max: 1` por instancia en postgres.js + `idle_timeout` corto; `DIRECT_URL` solo para migraciones. |
| La subscription SSE se corta por el límite de duración de la función | Se cae la demo en tiempo real | Duración máxima configurada en `vercel.ts`, `retry` del cliente SSE activado y prueba del flujo completo antes de grabar. |
| `LISTEN/NOTIFY` no disponible a través del pooler en modo transacción | Subscriptions sin eventos | La conexión que hace `LISTEN` usa el pooler en modo *session* o la conexión directa; queda aislada del pool de queries. Validar en F5 antes de construir la UI. |
| Sobre-ingeniería (federación, event sourcing completo) | No terminar a tiempo | Alcance congelado por este plan; toda ambición extra se documenta como "evolución futura" en el README en vez de implementarse. |
| Algún `fetch` REST se cuela (p.ej. una imagen desde una API) | Pierde el criterio Zero-REST completo | Assets locales; check en CI que hace grep de `fetch(`/`axios` fuera de `lib/apollo`. |

---

## 12. Preguntas abiertas / pendientes de confirmar

1. **Dataset**: falta el link/CSV de los 50 medicamentos → colocarlo en `db/seed/medications.csv`.
2. **Grupo**: ¿individual o hasta 3 integrantes? Define los créditos del README y del video.
3. **Autenticación**: el enunciado menciona "autenticar" solo dentro del Zero-REST. Plan actual: `patientId`
   simulado vía header/contexto, sin login real. Si se quiere sumar, se haría con una mutation `login`
   (nunca un endpoint REST).
4. **Despliegue**: confirmado en Vercel (proyecto único). Falta decidir si la sustentación se graba contra la
   URL de producción o contra `localhost` (los logs del DataLoader se ven mejor en local).

---

## 13. Estado del entorno (checklist de arranque)

| Paso | Estado |
|---|---|
| MCP de Supabase en `.mcp.json` (`project_ref = wcmiyijouostqxrusqrd`) | ✅ configurado |
| Conflicto con el MCP `supabase` de scope user (proyecto viejo `vapnqz…`) | ✅ resuelto — renombrado a `supabase-legacy` |
| Aprobar y autenticar el MCP `supabase` del proyecto | ✅ autenticado — `https://wcmiyijouostqxrusqrd.supabase.co`, esquema `public` vacío |
| MCP de Vercel | ✅ conectado y autenticado (team `jdcareborn-5876s-projects`) |
| Vercel CLI | ✅ instalada (v59.23.2) y con sesión iniciada (`jdcareborn-5876`) |
| Agent Skills de Supabase (`.agents/skills/`) | ✅ instaladas (supabase + postgres-best-practices) |
| Skills de diseño `Leonxlnx/taste-skill` | ✅ instaladas (13 skills, 541 KB en `.agents/skills/`) |
| `DATABASE_URL` (pooler 6543) y `DIRECT_URL` (5432) | ⏳ pendientes — con `vercel env add`, nunca al repo |
| CSV oficial de los 50 medicamentos → `db/seed/medications.csv` | ⏳ pendiente (link del docente) |

Con eso listo se ejecuta **F0** (andamiaje Next.js + `/graphql`) y **F1** (migraciones + seed en Supabase).

---

## 14. Estado de avance — 2026-09-20

### Hecho y verificado

| Fase | Estado | Evidencia |
|---|---|---|
| **F0 — Andamiaje** | ✅ | Next.js 16.3.5 + React 19.2.8 + TS + Tailwind v4; `npm run build` pasa; 4 rutas + `/graphql` |
| **F1 — Supabase + dataset** | ✅ | 7 migraciones aplicadas por MCP; 50 medicamentos, 14 categorías, 16 laboratorios, 50 principios activos; `EXPLAIN ANALYZE` confirma Bitmap Index Scan sobre el GIN de `search_vector` |
| **F2 — Contrato SDL** | ✅ | `schema.graphql` (536 líneas, 51 tipos) ensamblado desde 4 módulos con `npm run schema` |
| **F3 — Read side** | ✅ verificado | 3 repositorios de lectura + 9 DataLoaders + plugin de Apollo que loguea el conteo de SQL por operación |
| **F4 — Write side** | ✅ verificado | Comandos de carrito, receta, `placeOrder` transaccional, y ciclo de vida (approve/dispatch/cancel); 15 pruebas de invariantes en verde |
| **F5 — Projector + Subscriptions** | ✅ verificado | Outbox con `for update skip locked`, `waitUntil`, `LISTEN/NOTIFY` y subscription por SSE |
| **F6 — Frontend** | ✅ verificado | ApolloProvider en `layout.tsx`, 5 pantallas, `useQuery`/`useMutation`/`useSubscription`, `fetchMore` paginado y `update()` de caché en `placeOrder` |
| **F7 — Despliegue** | ⏳ | Falta cargar env en Vercel y desplegar |
| **F8 — Documentación** | ⏳ | Falta README con diagrama y `docs/cqrs.md` |
| **F9 — Evidencias y video** | ⏳ | Pendiente |

### Verificación contra la base real (2026-09-20, `npm run dev` + `node scripts/e2e-flow.mjs`)

| Qué | Resultado medido |
|---|---|
| Conexión pooler 6543 y sesión 5432 | ambas OK contra `aws-0-us-west-2.pooler.supabase.com` |
| `LISTEN/NOTIFY` a través del pooler | OK — el `NOTIFY` emitido en la conexión de transacción llega a la de sesión |
| **N+1** — `medications(first:20)` con `category { name medicationCount }` | **4 consultas SQL** (ingenuo: 42). Los loaders deduplican: 20 medicamentos → 11 categorías distintas → 11 claves → 1 consulta |
| Invariante de receta | `placeOrder` sin fórmula → `PRESCRIPTION_REQUIRED`, nombrando el medicamento culpable |
| Invariante de stock | pedir 166 con 116 disponibles → `OUT_OF_STOCK` con `requested`/`available` |
| Ciclo de vida | aprobar dos veces → `INVALID_STATE (APPROVED → APPROVED)` |
| Idempotencia | reenviar la misma `idempotencyKey` devuelve la misma orden, no crea otra |
| Consistencia eventual | inmediatamente tras el comando: `freshness=SYNCING version=0`; a los 2.5 s: `UP_TO_DATE version=1` |
| Subscription SSE | estado inicial + push de `DISPATCHED version=3` tras el comando, por `text/event-stream` en `/graphql` |
| Zero-REST | un solo `route.ts` en toda la app (`src/app/graphql/route.ts`); ningún `fetch`/`axios` fuera de Apollo |
| Páginas | `/`, `/medicamentos/[id]`, `/carrito`, `/ordenes`, `/ordenes/[id]` → HTTP 200 con contenido |

### Bugs encontrados y corregidos durante la verificación

1. **`Query.order` devolvía `null`** justo después de emitir el pedido, porque la proyección
   todavía no existía. Se implementó el fallback de read-your-writes previsto en §6.4:
   si hay eventos pendientes, se reconstruye desde el write model y se marca `SYNCING`.
   La función vive ahora en el read side, documentada como la única lectura del modelo
   transaccional.
2. **El schema no se recargaba con HMR**: `apolloServer()` cacheaba la instancia en
   `globalThis` también en desarrollo. Ahora solo cachea en producción.
3. **500 en todas las páginas**: no era del código — se habían acumulado 11 procesos
   `node` de reinicios sucesivos y Turbopack entraba en pánico al levantar el worker de
   PostCSS (`0xc0000142`). Con reinicio limpio, todo 200.

### Desviaciones respecto del plan original (y por qué)

| Plan original | Lo que se hizo | Motivo |
|---|---|---|
| Apollo Server 4 / Apollo Client 3 | **Apollo Server 5 / Apollo Client 4** | Son las versiones actuales; `@as-integrations/next@4` soporta AS5 y Next 16 |
| `graphql-codegen` para tipos del cliente | Tipos escritos a mano en `src/lib/types.ts` | El codegen agrega un paso de build para un beneficio que en 5 pantallas es marginal. La rigurosidad del contrato ya se evalúa sobre el SDL |
| Categorías N:M (`medication_categories`) | 1:N — cada medicamento tiene una categoría | Es lo que trae el dataset del docente. El escenario N+1 se mantiene intacto: son 3 FK anidadas por medicamento más el cruce orden ↔ catálogo |
| `db/functions/place_order.sql` en PL/pgSQL | Transacción en TypeScript con `sql.begin()` | Las invariantes de negocio quedan en el dominio (testeable sin base) y no repartidas entre SQL y app. La atomicidad es la misma: `UPDATE … WHERE stock >= cantidad` dentro de la transacción |
| Migración `006`/`007` no previstas | `006_seed_staging`, `007_move_pg_trgm_out_of_public` | La segunda resuelve un WARN del linter de seguridad de Supabase (extensiones fuera de `public`) |
| Carrito solo en el cliente | Carrito como agregado del write model | El enunciado nombra "creación de carritos" y "adición de medicamentos" como comandos de dominio |

### Pendientes conocidos

1. **Advisor de Supabase**: 13 tablas con RLS activa y sin políticas (nivel INFO). Es deliberado
   — deny-all, el acceso es solo por el servidor GraphQL con rol privilegiado — y hay que
   sustentarlo así, no "arreglarlo".
2. **`LISTEN/NOTIFY` sin verificar** contra Supabase: la conexión del listener usa `DIRECT_URL`.
   Hay que probarlo en F5 antes de grabar el video.
3. **Sin `docs/cqrs.md` ni README todavía**: se escriben después de verificar de punta a punta,
   para que los números de N+1 del README salgan de logs reales y no de una estimación.

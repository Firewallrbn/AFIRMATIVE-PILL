# Guion de la sustentación (5–8 minutos)

Cronometrado para 7 minutos con margen. Cada bloque dice **qué mostrar**, **qué decir** y
**qué tiene que verse en pantalla** — porque la rúbrica no evalúa el discurso, evalúa la
evidencia.

## Antes de grabar

- [ ] `npm run dev` corriendo, con `LOG_LEVEL=debug` y la consola del servidor **visible**.
- [ ] DevTools abierto en la pestaña **Network**, filtro `Fetch/XHR`, columna de tamaño visible.
- [ ] Carrito vacío (borrar `localStorage` o usar ventana de incógnito).
- [ ] Tres ventanas listas: navegador, consola del servidor, Apollo Sandbox (`/graphql`).
- [ ] Verificar que el catálogo carga — el primer request despierta la conexión a Supabase y
      tarda unos segundos; no queremos ese cold start grabado.

---

## 0 · Presentación — 20 s

> "Afirmative Pill: e-commerce farmacéutico con dos reglas que no se pueden romper —
> no se despacha un controlado sin fórmula médica, y no se vende inventario que no existe.
> Todo cursa por GraphQL, y lectura y escritura están segregadas con CQRS."

---

## 1 · Escenario A — catálogo y anti over-fetching — 70 s

**Mostrar**: la portada, escribir "antibiótico" en el buscador, marcar la faceta "Con
fórmula médica".

**Decir**: que la búsqueda va contra un `tsvector` en español con índice GIN y que las
facetas se calculan con el mismo filtro, así que los números del sidebar nunca contradicen
la grilla.

**➜ EVIDENCIA 1 — Zero-REST y over-fetching.** Abrir el request en Network:

- La URL es **`/graphql`**. No hay `/api/medicamentos`, no hay `/api/` de nada.
- Abrir la pestaña **Response** y recorrerla: trae `id`, `name`, `price`, `presentation`,
  `requiresPrescription`, `inStock`, `category`. **No trae** `description`, ni
  `laboratory`, ni `activeIngredient`, ni `stock`.

> "La grilla pide `MedicationSummary`. Pintar 50 tarjetas no descarga 50 fichas clínicas.
> Es el mismo endpoint y el mismo dominio, pero el cliente pide exactamente lo que va a
> pintar."

Hacer clic en un medicamento → la ficha.

> "Ahora sí pide la descripción, el laboratorio, el principio activo y las alternativas —
> porque ahora sí las va a mostrar."

---

## 2 · ➜ EVIDENCIA 2 — DataLoader y el problema N+1 — 80 s

**Mostrar**: cambiar a la consola del servidor con el catálogo recién cargado.

**Señalar las líneas**:

```
[dataloader] categoryById: 11 clave(s) agrupada(s) en 1 consulta SQL
[dataloader] medicationCountByCategoryId: 11 clave(s) agrupada(s) en 1 consulta SQL
[graphql] CatalogMedications resuelta con 4 consulta(s) SQL
```

**Decir**:

> "La grilla pide 20 medicamentos y, de cada uno, su categoría. GraphQL ejecuta ese
> resolver 20 veces. Resolviendo cada uno por su cuenta serían 42 consultas: una de la
> página, una del total, 20 de categorías y 20 de conteos.
>
> Con DataLoader son **cuatro**. Y fijense en el 11: son 20 medicamentos pero 11
> categorías distintas — el loader deduplica antes de agrupar, así que la consulta viaja
> con 11 claves y no con 20.
>
> Los loaders se crean **por request**, no globalmente. Un loader compartido cachearía el
> stock entre pacientes distintos, y en una farmacia eso significa venderle a alguien un
> medicamento que ya no está."

Opcional si sobra tiempo: mostrar `src/server/loaders/index.ts` y la consulta
`where id = any($1)`.

---

## 3 · Escenario B — la invariante de la fórmula médica — 90 s

**Mostrar**: agregar al carrito un medicamento de venta libre y uno de control (por
ejemplo Alprazolam o Clonazepam — se distinguen por el distintivo ámbar "Fórmula médica").

Ir al carrito. Intentar **Confirmar pedido** con el formulario de receta vacío.

**➜ EVIDENCIA 3 — error de dominio tipado.** El botón está deshabilitado y el panel ámbar
explica por qué. Para mostrar el error del servidor, usar Apollo Sandbox:

```graphql
mutation { placeOrder(input: { cartId: "N", idempotencyKey: "demo-1" }) {
  order { id }
  errors { code message ... on PrescriptionRequiredError { medications { name } } }
} }
```

**Decir**:

> "El error viene **dentro del payload**, tipado, no como un error HTTP. Un medicamento que
> exige receta no es un fallo del servidor: es un resultado válido del comando. Y viene con
> datos — dice exactamente cuál de los medicamentos obliga a la fórmula, así que la UI
> puede señalarlo en vez de mostrar 'algo salió mal'."

Llenar el formulario de fórmula médica → **Adjuntar** → ahora el botón se habilita →
**Confirmar pedido**.

---

## 4 · Escenario C — consistencia eventual y tiempo real — 100 s

**Mostrar**: la pantalla de seguimiento, inmediatamente después de confirmar.

**➜ EVIDENCIA 4 — consistencia eventual visible.** Señalar el banner azul *"Consolidando tu
pedido…"* con el punto pulsante.

> "El comando ya está confirmado: el stock se descontó y la orden existe. Lo que todavía no
> alcanzó es la **proyección de lectura**. El contrato lo declara con un campo,
> `freshness: SYNCING`, y la interfaz lo dice en palabras en vez de mostrar un dato viejo
> como si fuera definitivo.
>
> Esa es la respuesta a la pregunta del enunciado: el usuario ve su pedido, y ve que se
> está consolidando."

El banner desaparece solo al segundo. En la consola del servidor:

```
[projector] 1 evento(s) proyectado(s) — read model al día
```

**➜ EVIDENCIA 5 — Subscription en vivo.** Bajar al panel de operación y tocar **Validar
fórmula y aprobar**.

> "Esto lo haría el químico farmacéutico desde su propio panel. Miren el estado de arriba."

El estado cambia a **Aprobado** sin recargar. Mostrar en Network que hay un request
`/graphql` con `Content-Type: text/event-stream` que sigue abierto.

> "Es una GraphQL Subscription sobre Server-Sent Events, por el **mismo** `/graphql`. No
> hay polling ni `refetch`: el servidor avisa cuando la proyección quedó consistente, y
> Apollo escribe el resultado en su caché normalizada. React vuelve a pintar solo."

Tocar **Despachar** para mostrar el segundo push.

---

## 5 · La invariante de inventario — 50 s

**Mostrar**: Apollo Sandbox, o un segundo pedido con una cantidad absurda.

```graphql
mutation { placeOrder(input: { cartId: "M", idempotencyKey: "demo-2" }) {
  order { id }
  errors { code ... on OutOfStockError { medicationName requested available } }
} }
```

**Decir**:

> "El control no está en un `if` de la aplicación: está en el `UPDATE`.

```sql
update medications set stock = stock - $q where id = $id and stock >= $q
```

> Si entre la validación y el commit otra persona se llevó las últimas unidades, esta
> sentencia afecta cero filas y la transacción entera se revierte. Dos compras simultáneas
> del último medicamento no pueden ganar las dos."

Si hay tiempo: mostrar `node scripts/e2e-flow.mjs` corriendo los 11 pasos en verde.

---

## 6 · Arquitectura — 60 s

**Mostrar**: el diagrama del README y el árbol de carpetas.

> "La segregación no es conceptual, está en el disco: `query-side` solo tiene SELECT sobre
> proyecciones; `command-side` tiene las transacciones y las invariantes. El único puente
> entre los dos es el outbox `domain_events`, y el evento se inserta **en la misma
> transacción** que el cambio de estado — es imposible que exista una orden sin su evento.
>
> Y en toda la aplicación hay **un solo** `route.ts`: `/graphql`. Ni un `fetch` fuera de
> Apollo."

Mostrar en la terminal:

```bash
find src/app -name "route.ts"
grep -rn "fetch(\|axios" src/app src/components src/lib | grep -v apollo
```

---

## 7 · Cierre — 20 s

> "50 medicamentos reales en Supabase, contrato de 51 tipos con scalars propios y errores
> de dominio tipados, 42 consultas reducidas a 4 con DataLoader, y consistencia eventual
> que el usuario puede ver en vez de sufrir."

---

## Checklist de la rúbrica — ¿quedó todo filmado?

| Criterio | Bloque del guion |
|---|---|
| Schema SDL riguroso | 1, 3 (scalars y errores tipados en Sandbox) |
| Selección selectiva de campos / anti over-fetching | **Evidencia 1** |
| Mutations orientadas a intención + errores ricos | **Evidencia 3** |
| Mitigación del N+1 con DataLoader | **Evidencia 2** |
| Zero-REST | Evidencia 1 y bloque 6 |
| Segregación CQRS | Bloque 6 |
| Manejo de invariantes | Bloques 3 y 5 |
| Consistencia eventual | **Evidencia 4** |
| Apollo Client: hooks, caché, subscriptions | **Evidencia 5** |
| Supabase con el dataset cargado | Bloque 1 (catálogo con los 50) |

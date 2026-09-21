# TALLER PRÁCTICO AVANZADO — CASO DE ESTUDIO "AFIRMATIVE-PILL"

> Registro del enunciado entregado por el docente. Fuente de verdad contra la cual se valida el alcance
> del proyecto. No modificar salvo que el docente actualice el enunciado.

**Arquitectura de Software Basada en GraphQL y CQRS para E-Commerce Farmacéutico**

## 1. Información general

| Campo | Valor |
|---|---|
| Institución | Facultad de Ingeniería de Sistemas |
| Materia | Ingeniería de Software Avanzada / Patrones Arquitectónicos |
| Modalidad | Grupos de máximo 3 estudiantes (o individual) |
| Ponderación | Calificación sobre 5.0 puntos |
| Enfoque evaluativo | Arquitectura de solución, autonomía técnica y diseño de contratos |

## 2. Contexto y caso de estudio

Afirmative Pill es una compañía HealthTech / E-Commerce farmacéutico que conecta pacientes, farmacias aliadas
y entidades promotoras de salud para la distribución y venta minorista de medicamentos en línea.

Retos operacionales y regulatorios del sector:

1. **Regulación sobre formulación médica**: medicamentos OTC (venta libre) frente a medicamentos que exigen
   prescripción médica verificada antes de autorizar la orden.
2. **Concurrencia crítica de inventario**: el inventario debe reservarse de forma atómica y consistente;
   vender un medicamento no disponible a un paciente crítico acarrea consecuencias de salud y sanciones legales.
3. **UX fluida vs. catálogos complejos**: fichas técnicas profundas (principios activos, presentaciones,
   contraindicaciones, laboratorios) generan over-fetching y latencia en redes móviles bajo APIs tradicionales.
4. **Desacoplamiento lectura/escritura**: millones de lecturas y búsquedas facetadas del catálogo, frente a
   comandos transaccionales complejos (pagos, validación médica, despachos) con respuesta asíncrona.

Pilares ordenados por el equipo de arquitectura:

- Comunicación cliente-servidor **exclusivamente GraphQL** (prohibición absoluta de REST en el canal de clientes).
- **CQRS**: aislamiento de los modelos de consulta y los modelos transaccionales de mutación.

## 3. Requerimientos y libertad de implementación

> Nota metodológica: el taller NO contiene tutoriales paso a paso ni recetas de código. Libertad total sobre
> schema SDL, persistencia, organización de carpetas y algoritmos de resolución, siempre que se satisfagan los
> requerimientos arquitectónicos **no negociables**.

### 3.1. Prohibición absoluta de REST (Zero-REST Mandate)
- Toda interacción de red frontend↔backend debe cursar exclusivamente mediante operaciones GraphQL
  (Queries, Mutations y Subscriptions).
- Ninguna vista del cliente puede consultar endpoints HTTP REST para obtener catálogos, autenticar o
  despachar órdenes.

### 3.2. Ecosistema Apollo
- **Backend**: Apollo Server (monolito modular o arquitectura federada de subgraphs con Apollo Gateway/Router).
- **Frontend**: React / Next.js con Apollo Client configurado mediante el árbol de contexto de Apollo
  (ApolloProvider / Apollo Context) para la gestión unificada de estados y caché.

### 3.3. Patrón CQRS

**Comandos (Write Model / Mutations)**
- Toda modificación de estado (creación de carritos, adición de medicamentos, validación de recetas, reserva de
  inventario, confirmación de orden) debe modelarse como un comando que exprese **intención de negocio**.
- Deben protegerse las invariantes: no permitir órdenes de medicamentos con fórmula médica sin validación, no
  procesar compras de ítems agotados.

**Consultas y proyecciones (Read Model / Queries)**
- Pantallas de exploración, fichas técnicas y resúmenes de órdenes alimentadas por **modelos proyectados**
  optimizados para lectura.
- Contemplar la **consistencia eventual** inherente al flujo: ¿qué ve el usuario mientras la orden está siendo
  validada o el stock se está sincronizando?

### 3.4. Catálogo de medicamentos y persistencia (Supabase)
- El backend debe persistir y consultar en **PostgreSQL alojado en Supabase**.
- Se suministra una tabla base con **50 registros de medicamentos reales**, clasificados por principio activo,
  presentación, laboratorio, precio, stock y requisito de fórmula médica.

## 4. Historias de usuario y escenarios a resolver

### Escenario A — Exploración eficiente de fármacos (lecturas optimizadas)
- Como paciente, quiero buscar medicamentos filtrando por nombre comercial, principio activo o categoría
  terapéutica, visualizando una **vista condensada** (nombre, precio, presentación) sin sobrecargar mi conexión
  móvil con el resto de información clínica.
- Como paciente, quiero abrir la **ficha detallada** de un medicamento para inspeccionar laboratorio,
  indicaciones y si requiere prescripción médica.
- **Restricción de rendimiento backend**: el servidor debe resolver estas consultas complejas y anidadas
  **sin caer en el problema N+1** al asociar entidades (medicamentos y sus categorías o recetas asociadas).

### Escenario B — Creación de pedido y control de prescripción (comandos de dominio)
- Como paciente, quiero armar un pedido con múltiples ítems y cantidades.
- Si alguno de los medicamentos tiene `requires_prescription = true`, la mutación debe **exigir la información
  de soporte de la fórmula médica** antes de transicionar la orden a estado aceptado.
- El comando debe validar la disponibilidad del stock en bodega y **decrementar la cantidad de forma consistente**.

### Escenario C — Seguimiento y proyección del pedido (eventual consistency & real-time)
- Una vez emitido el comando de compra, el cliente debe poder consultar una **proyección del pedido** con su
  costo total, detalle de ítems y estado operacional (`PENDING_APPROVAL`, `APPROVED`, `DISPATCHED`, `CANCELLED`).
- Se valorará la integración de actualizaciones en tiempo real (vía **GraphQL Subscriptions**) cuando el estado
  del pedido cambie en el backend.

## 5. Rúbrica de evaluación (sobre 5.0)

### 1. Diseño e implementación de GraphQL — 40% (2.0 pts)
- **Schema SDL riguroso**: modelado coherente de Object Types, Scalars personalizados, Enums, Inputs y Payloads tipados.
- **Operaciones de lectura y escritura**: Queries bien estructuradas que aprovechan la selección selectiva de
  campos contra el over-fetching; Mutations orientadas a intenciones del dominio con respuestas ricas en errores
  de validación.
- **Mitigación del problema N+1**: implementación demostrable de resolución en lotes y caché por request
  (patrón DataLoader o equivalente en resolvers anidados).
- **Zero-REST**: cumplimiento total de la restricción de cero endpoints REST.

### 2. Arquitectura CQRS y modelo de dominio — 25% (1.25 pts)
- **Segregación conceptual y técnica** entre operaciones de comando (mutaciones transaccionales) y modelos de
  lectura/proyección.
- **Manejo de invariantes**: validación estricta de reglas de negocio farmacéuticas (stock, recetas médicas).
- **Tratamiento de consistencia eventual**: estrategia clara para la latencia entre la confirmación del comando
  y la actualización de la proyección en la UI.

### 3. Frontend con Apollo Client & Context — 20% (1.0 pts)
- **Configuración del cliente**: uso correcto del ApolloProvider / Apollo Context en el árbol raíz.
- **Consumo y caché local**: uso idiomático de hooks (`useQuery`, `useMutation`, `useSubscription`), manejo
  reactivo de estados (`loading`, `error`, `data`) y actualización inteligente de la caché en memoria tras una mutación.

### 4. Persistencia en Supabase, calidad y sustentación — 15% (0.75 pts)
- **Base de datos**: carga exitosa del dataset de 50 medicamentos en Supabase (PostgreSQL) y consultas bien indexadas.
- **Estructura y documentación**: repositorio limpio con diagrama arquitectónico del sistema, instrucciones de
  arranque y justificación de decisiones tomadas en el diseño del schema.

## 6. Entregables esperados

1. **Enlace al repositorio de código**
   - Código fuente completo del Frontend y Backend.
   - `README.md` detallado que incluya:
     - Diagrama de arquitectura (React Apollo Client ↔ Apollo Server ↔ resolvers/DataLoader ↔ Supabase).
     - Definición completa del Schema SDL (`schema.graphql`).
     - Breve justificación de cómo se aplicó CQRS y cómo se mitigó el problema N+1.
2. **Video demostrativo / sustentación (5 a 8 minutos)**
   - Demostración en vivo del flujo: Catálogo → Selección → Carrito → ejecución de Mutation → consulta de la
     orden proyectada.
   - Inspección en DevTools ▸ Network: evidencia de que todas las llamadas van a `/graphql` y que la respuesta
     devuelve exactamente los campos pedidos, sin over-fetching.
   - Evidencia en logs del servidor de cómo el DataLoader agrupa las consultas a Supabase en una única
     operación en lote.

## 7. Recursos y anexos

- **Dataset de medicamentos**: link suministrado por el docente — *pendiente de anexar al repositorio*
  (ver `db/seed/` en el plan de trabajo).
- Documentación de referencia:
  - Apollo Server Docs (Schemas, Resolvers & Federation)
  - Apollo Client React Docs (Queries, Mutations & Cache)
  - DataLoader Specification (GitHub / NPM)
  - Supabase PostgreSQL Quickstart

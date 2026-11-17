# Diseño: disponibilidad declarada

## 1. Decisiones

| # | Tema | Decisión propuesta |
| --- | --- | --- |
| D1 | Canal | Solo `DECLARE_AVAILABILITY` en `/v1/sync/push`. **No** se agrega `POST /v1/me/availability`: así hay un único camino, que además funciona sin conexión. El panel web no declara |
| D2 | Hora del cambio | La misma estimación que las respuestas: `estimatedAt` sale del reloj monotónico o del desfase medido, nunca solo del reloj del teléfono, y se limita a `≤ receivedAt` |
| D3 | Orden entre declaraciones | Del mismo dispositivo, manda `deviceSeq`. De dispositivos distintos, manda `estimatedAt` con una ventana de 60 s. Ver §3 |
| D4 | Conflictos dentro de la ventana | Se resuelven solos (Q1): gana la de mayor `receivedAt`, que es la que acaba de llegar, así que el resultado es `APPLIED`. **No** pasan a revisión del coordinador ni cuentan en `pendingReviews`. La declaración anterior queda en el historial |
| D5 | Desactualizada | Se **calcula** como `ahora − declaredAt > 4 h` (`AVAILABILITY_STALE_HOURS`, por defecto 4); nunca se guarda. La antigüedad no cambia el estado (§3.2.4) |
| D6 | Sin declarar | Un brigadista que nunca declaró se expone como `status: null` ("Sin declarar"), aunque la columna física tenga el valor por defecto `NO_DISPONIBLE`. Se distingue por `last_availability_change_id IS NULL` |
| D7 | Reconfirmar | Declarar el mismo estado otra vez crea un cambio nuevo en el historial y renueva `declaredAt` (Q2 del modelo lógico) |
| D8 | Cuenta o perfil inactivo | `REJECTED ACCOUNT_INACTIVE`. Quien no es brigadista recibe `REJECTED INVALID_PAYLOAD` |
| D9 | Independencia | Responder `VOY` no cambia la disponibilidad (RN-09). La disponibilidad no filtra ni ordena la convocatoria (RN-06) |

## 2. Datos (PostgreSQL)

No hace falta migración. Ya existen:

- `availability_change`: append-only, con `estimated_at`, `time_confidence`,
  `device_id`, `device_seq`, `base_row_version`, `sync_result` y `row_version`.
- `brigadista_profile`:
  - `availability_status`, `availability_declared_at` y
    `last_availability_change_id`, que apunta al cambio vigente;
  - el índice parcial `brigadista_panel_idx` para el panel.

Al aplicar una declaración con resultado `APPLIED` se hace lo siguiente, en
una sola `replicatedWrite`:

1. Se inserta el cambio en `availability_change`.
2. Se actualizan las tres columnas del perfil. Su `row_version` sube por trigger.
3. Se registra la operación en `sync_operation`.

Con resultado `SUPERSEDED` o `CONFLICT` el cambio queda en el historial y el
perfil no se toca.

## 3. Orden y conflictos

La regla vigente es la de `docs/database/synchronization/conflict-resolution.md`,
la misma que ya implementa el backend para las respuestas.

| Situación | Resultado |
| --- | --- |
| Mismo dispositivo, `deviceSeq` mayor que el del cambio vigente | `APPLIED` |
| Mismo dispositivo, `deviceSeq` menor (llegó tarde) | `SUPERSEDED` |
| Otro dispositivo, posterior por más de 60 s | `APPLIED` |
| Otro dispositivo, anterior por más de 60 s | `SUPERSEDED` |
| Otro dispositivo, diferencia de 60 s o menos | `APPLIED` (Q1: gana la que llegó última; sin revisión) |

**Inconsistencia que hay que corregir:** `docs/database/synchronization/strategy.md`
§4 dice "última declaración gana por `declared_at`" (la hora del teléfono). Eso
contradice `conflict-resolution.md` y la decisión de no depender del reloj del
dispositivo. database-architect debe alinear `strategy.md` con
`conflict-resolution.md`. La fila de respuestas de esa misma tabla también
quedó desactualizada.

## 4. Contrato (OpenAPI v1, aditivo)

| Elemento | Cambio |
| --- | --- |
| `AvailabilityStatus` | Nuevo enum: `DISPONIBLE`, `NO_DISPONIBLE`, `EN_SERVICIO` |
| `Availability` | Nuevo objeto: `{ status: AvailabilityStatus \| null, declaredAt: Timestamp \| null, stale: boolean, rowVersion }` |
| `SyncOperationType` | Suma `DECLARE_AVAILABILITY` |
| `DeclareAvailabilityOperation` | `SyncOperationBase` + `baseRowVersion` (del perfil, como lo veía el teléfono) + `payload: { status }` |
| `SyncOperationResult` | Para esta operación, `entityId` es el `availability_change.id` (= `operationId`) y `rowVersion` es la del perfil |
| `BrigadistaSelf` (en `/v1/me`) | Suma `availability: Availability` |
| `BrigadistaSummary` | Suma `availability: Availability` |
| `GET /v1/brigadistas` | Nuevo filtro `availability=DISPONIBLE\|NO_DISPONIBLE\|EN_SERVICIO\|STALE\|UNDECLARED` |
| `DashboardSummary.availability` | Nuevo: `{ disponible, noDisponible, enServicio, stale, undeclared }`. `stale` se cuenta aparte **y** dentro de su estado |
| `GET /v1/brigadistas/{id}/availability-history` | Nuevo: lista paginada por cursor (50 por página) con `status`, `estimatedAt`, `receivedAt`, `timeConfidence`, `createdOffline`, `syncResult` y `source`. Exige `COORD` o `ADMIN` |
| Ámbito `availability` de `SyncCursors` | Vuelve cuando exista `/v1/sync/pull`. Hasta entonces, el teléfono lee su estado vigente en `/v1/me` |

Una app v1 nunca emite la operación nueva y no se rompe con los campos
nuevos, porque la API se despliega antes que la app (garantía del contrato).

## 5. Teléfono (SQLite y cola)

- La revisión 5 del esquema SQLite trae de vuelta `brigadista_profile`, que
  solo guarda la fila propia con el estado vigente, y `availability_change`,
  con los cambios pendientes y el historial propio reciente. También devuelve
  `DECLARE_AVAILABILITY` al tipo de operación de `outbox`. La limpieza borra
  los cambios `SYNCED` de más de 30 días (`offline-storage.md`).
- Al declarar sin conexión, la app muestra el estado nuevo de inmediato con la
  marca "pendiente de enviar". Cuando el servidor contesta `SUPERSEDED` o
  `CONFLICT`, la app adopta el estado vigente que entrega `/v1/me`.
- La demo actual guarda su cola en SecureStore. Ahí basta con agregar el tipo
  de operación; la migración a SQLite queda para la arquitectura definitiva de
  mobile-architect.

## 6. Interfaz (borrador; lo define ui-ux-designer)

**App:**
- Bloque "Mi disponibilidad" en la pantalla principal con tres botones grandes
  (≥ 48 dp, con icono y texto) y la línea "Actualizado hace X".
- Pasadas 4 h, aviso "¿Sigue vigente?" con un botón para reconfirmar.
- Con una convocatoria activa, la tarjeta de la convocatoria va primero. La
  disponibilidad queda debajo, con la nota "Esto no responde la convocatoria".

**Panel:**
- En la pestaña Brigadistas: columna "Disponibilidad", con icono, texto y
  antigüedad, y chips de conteo que sirven de filtro.
- En la vista sin convocatoria: los mismos conteos.
- Al abrir un brigadista: su historial de cambios.
- Desactualizada: icono `◷` y el texto "hace 6 h"; nunca solo por color.

## 7. Preguntas resueltas (2026-11-17)

El usuario eligió la recomendación en las tres.

| # | Pregunta | Decisión |
| --- | --- | --- |
| Q1 | ¿Dos declaraciones con 60 s o menos de diferencia desde teléfonos distintos van a revisión del coordinador? | **No.** Se resuelven solas (gana la última que llegó) y quedan en el historial. La disponibilidad es informativa, y una revisión manual sumaría trabajo al coordinador durante una emergencia |
| Q2 | ¿El coordinador puede cambiar la disponibilidad de un brigadista? | **No en el MVP.** Requiere `COORDINATOR_PROXY`, que sigue fuera de v1 |
| Q3 | ¿Se avisa con push cuando el dato se desactualiza? | **No.** Basta con el aviso dentro de la app; un push recurrente se vuelve ruido y compite con las convocatorias |

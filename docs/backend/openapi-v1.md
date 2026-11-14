# Contrato OpenAPI v1 — guía de revisión

> **Estado (2026-11-14): APROBADO por el usuario.** Contrato en
> [`backend/openapi/openapi.yaml`](../../backend/openapi/openapi.yaml)
> (OpenAPI 3.1, `1.0.0`). **No hay implementación todavía**: la API se
> programa en la etapa 2, que requiere autorización del usuario.

Decisiones de base ya aprobadas por el usuario (2026-11-13): D-B1 a D-B6
([`plan.md`](plan.md)) y el alcance del MVP (§1).

## 1. Alcance de v1

| Incluido | Endpoints |
|---|---|
| Autenticación con RUT, renovación rotativa, cierre de sesión, cambio de contraseña, mis dispositivos | `/v1/auth/*`, `/v1/me`, `/v1/me/devices*` |
| Sincronización offline-first: responder `VOY` / `NO_PUEDO`, acuses, token push | `/v1/sync/push`, `/v1/sync/pull` |
| Respaldo del push al abrir la app | `/v1/me/active-emergency` |
| Preparación de la brigada | `/v1/dashboard/summary`, `/v1/brigadistas` |
| Convocatorias: borrador, activar, avisos de actualización, cerrar, convocados tarde | `/v1/emergencies*` |
| Panel con polling y `ETag` (llegada separada de respuesta) | `…/active/summary`, `…/{id}/recipients`, `/v1/recipients/{id}/history` |
| Revisión de conflictos y rechazos (`NOTE`, `CONFIRMED`, `DISMISSED`) | `/v1/sync-reviews*` |
| Administración: cuentas, provisoria, roles, brigadistas, dispositivos, auditoría | `/v1/users*`, `/v1/devices/*/revoke`, `/v1/audit-log` |

| Fuera de v1 (el modelo de datos ya lo soporta; se agrega sin romper el contrato) |
|---|
| Disponibilidad declarada (`DECLARE_AVAILABILITY`, `POST /v1/me/availability`, conteos por disponibilidad) |
| Reabrir convocatorias (aviso `REOPEN`) |
| Respuesta registrada por el coordinador en nombre del brigadista (`COORDINATOR_PROXY`) y, con ella, la resolución `CORRECTED` |
| Registro de contacto manual (`manual_contact`) — decidido fuera de v1 (C14) |
| Configuración general editable (D-B4: variables de entorno) |
| Recuperación de contraseña por correo (D-B6) |

## 2. Requisitos fundamentales → cómo los cumple el contrato

| Requisito | Mecanismo en el contrato |
|---|---|
| **R1.** Notificar a **todos** los brigadistas activos, sin depender de la disponibilidad ni de la última conexión | `activateEmergency`: convocado por cada cuenta activa con perfil de brigadista activo; push a **todo** dispositivo no revocado con token válido, sin filtrar por `lastSeenAt`. La convocatoria existe en la bandeja aunque no haya push. Quien se activa durante una emergencia queda convocado **automáticamente** (C1). La preparación (`ReadinessState`) es informativa y nunca filtra |
| **R2.** Responder sin Internet y sincronizar al reconectar | La respuesta es una operación `RESPOND_EMERGENCY` creada en el teléfono (`createdOffline`) y enviada por `/v1/sync/push` cuando hay red; `/v1/me/active-emergency` y `/v1/sync/pull` traen la convocatoria aunque el push se haya perdido |
| **R3.** Sincronización segura, idempotente y que no dependa solo del reloj del teléfono | Sesión móvil obligatoria; el dispositivo sale de la sesión, no del cuerpo. Idempotencia por `operationId` (`duplicate: true`). Orden: `deviceSeq` dentro de un teléfono; `estimatedAt` del servidor con reloj monotónico (`monotonicMs` + `bootSessionId`), desfase medido (`clock.deviceNow`) o recepción; nada en el futuro; ventana de 60 s → `CONFLICT`. `baseRowVersion` detecta escrituras concurrentes. `syncEpoch` recupera tras restaurar un backup |
| **R4.** Las respuestas sobreviven a un cierre inesperado de la app | El contrato lo hace posible y seguro: el `operationId` es el id de la fila creada en SQLite en la misma transacción que la cola, y reenviar tras reabrir (operaciones `IN_FLIGHT` → `PENDING`) nunca duplica. La persistencia local la implementa mobile-architect según `docs/database/synchronization/offline-storage.md` |
| **R5.** El servidor es la autoridad | Cada operación recibe un resultado decidido por el servidor (`APPLIED`/`SUPERSEDED`/`CONFLICT`/`REJECTED` con `code`); la respuesta vigente del convocado (`SyncRecipient.currentResponse`) la fija el servidor y el teléfono la adopta al descargar. Roles y permisos se releen en cada petición, nunca del token |

## 3. Decisiones tomadas al escribir el contrato

Estado al 2026-11-13: **C1, C2 y C4 aprobadas** por el usuario; **C14 decidida:
fuera de v1**. C7, C8 y C10 fueron revisadas por database-architect y ajustadas en el
contrato según su veredicto (§7). C15 aprobada el 2026-11-14. El contrato
completo fue aprobado el 2026-11-14.

Diferencias o precisiones respecto de [`endpoints.md`](endpoints.md) y
[`sync-contract.md`](sync-contract.md):

| # | Decisión | Motivo |
|---|---|---|
| C1 ✅ | Al **crear** un brigadista, **reactivar** su cuenta o **reactivar** su perfil durante una convocatoria activa, queda convocado automáticamente (`LATE_ADDITION`, autor = el administrador). E5 decía "propone agregarla" | R1: "todos los brigadistas activos". Una propuesta que nadie acepta en plena emergencia deja a alguien fuera |
| C2 ✅ | `logout` en móvil **borra el token push** de ese dispositivo. Una sesión **vencida** no lo borra | Un teléfono del que el usuario salió no debe seguir sonando. Con la sesión vencida sí debe sonar (R1); al abrir, pide login |
| C3 | Respaldo del brigadista en `GET /v1/me/active-emergency` (antes `GET /v1/emergencies/active`); `204` si no hay | Separa lo propio (`/me`) de la coordinación y evita confusión con `/v1/emergencies/active/summary` |
| C4 ✅ | Una convocatoria **activa** se cambia solo con un aviso (`POST …/notices` con `changes`), que aplica los cambios y notifica en la misma transacción. `PATCH` queda solo para borradores (con `If-Match`) | Ningún cambio de una convocatoria activa puede quedar sin aviso ni historial (E6) |
| C5 | Idempotencia de los `POST` del dashboard: `id` generado por el cliente en crear convocatoria, avisos y resoluciones; por estado en activar, cerrar, revocar, roles; por pareja natural en convocados tarde | Un reintento del BFF tras un corte no debe duplicar un aviso (un push extra a toda la brigada) |
| C6 | En `sync/push`, el sobre del lote se valida entero (`400`), pero cada operación se valida por separado → `REJECTED INVALID_PAYLOAD` | Una operación mal formada no debe bloquear las respuestas válidas del mismo lote |
| C7 🔁 | Un acuse equivalente a uno existente con otro `operationId` → `SUPERSEDED EQUIVALENT_ACK`, con el `entityId` del existente y `rowVersion: null` | Aprobada con cambios por database-architect (§7.1) |
| C8 🔁 | `UNSUPPORTED_OPERATION` para tipos que v1 no procesa: guardado en `sync_operation` si el modelo conoce el tipo (`DECLARE_AVAILABILITY`), solo auditoría si no. La colisión de `deviceSeq` deja de ser un rechazo por operación y pasa a `409 DEVICE_SEQ_CONFLICT` del lote | Aprobada con cambios; `SEQ_CONFLICT` por operación **rechazado** por database-architect (§7.2) |
| C9 | Llegada: se agrega `SENDING` (en cola o enviado, sin respuesta del proveedor). Preparación: se agrega `PUSH_DISABLED` (dispositivo sin token) | Faltaban en la tabla de `delivery-and-ack.md` §4; sin ellos el panel mostraría "falló" o "listo" durante los primeros segundos o con permisos negados |
| C10 🔁 | En la descarga, el perfil viaja como **una** instantánea (cuenta + perfil de brigadista), con versión = máximo de ambas; sin `mustChangePassword` | Aprobada con cambios por database-architect (§7.3) |
| C11 | `monotonicMs` y `bootSessionId` pueden ser `null` | Si Expo no expone el reloj monotónico, el servidor usa el desfase medido (`conflict-resolution.md` §3) |
| C12 | `emergencyType` es texto libre (≤ 100) en v1 | No hay catálogo definido; agregar uno después es compatible |
| C13 | Login móvil con un `device.id` de otro usuario → `409 DEVICE_ID_CONFLICT`; revocado → `403 DEVICE_REVOKED`. En ambos la app genera un id nuevo | Un teléfono compartido o reinstalado no debe heredar dispositivo ni token |
| C14 ✅ | **Contacto manual fuera de v1** (decidido por el usuario; se evalúa para una versión posterior) | No estaba en el alcance aprobado |
| C15 ✅ | Tras `409 DEVICE_SEQ_CONFLICT`, la app obtiene la sesión del `device.id` nuevo con un **login nuevo** (como C13): pide la contraseña. No se agrega un endpoint para cambiar de dispositivo | Aprobada por el usuario (2026-11-14). Es un caso excepcional (la prevención es guardar `device.id` solo en `device_identity`) y no agrega alcance. Las operaciones siguen pendientes en el teléfono, no se pierden |

## 4. Coordinación pendiente

| Con | Tema |
|---|---|
| mobile-architect | Forma de las operaciones y del `clock`; si Expo da reloj monotónico e id de arranque; regenerar `device.id` (`409 DEVICE_SEQ_CONFLICT`, C13, C15); guardar `device.id` solo en `device_identity`; aplicar la descarga padre → hijo; `SUPERSEDED EQUIVALENT_ACK` sin cambiar el id local; `REFRESH_RACE`; tolerar enumeraciones y ámbitos desconocidos |
| web-architect | Flujo del BFF con `LoginResponse`, `ETag` del polling, idempotencia por `id` (C5), `If-Match` en borradores, `Cache-Control: no-store` de la provisoria |
| database-architect | Revisión hecha (§7). Tras aprobar el contrato: revisión 3 de `sqlite/schema.md` y correcciones a sus documentos |
| devops-architect | Desplegar siempre el servidor antes que una app que emita un tipo de operación nuevo |
| ui-ux-designer | Textos por `code` (errores y `SyncResultCode`), estados de llegada (`ReachStatus`) y preparación (`ReadinessState`) |

## 5. Verificación realizada

Hecho localmente, sin servicios externos:

- El YAML carga; los 670 `$ref` resuelven; 41 operaciones con `operationId`
  único y parámetros de ruta declarados.
- Los 121 esquemas compilan con Ajv 8 en modo JSON Schema 2020-12 estricto (el
  mismo motor que usará Fastify).
- 36 casos de ejemplo se comportan como se espera: operaciones válidas de los
  tres tipos, rechazo de `RECEIVED` sin vía, de campos desconocidos (protección
  contra filtrar `passwordHash`), de lotes vacíos o de más de 50, de `CORRECTED`
  y de `DECLARE_AVAILABILITY` en v1.

No hecho todavía: lint con Redocly y generación de tipos con
`openapi-typescript`. Plan en §11.

## 6. Paquete compartido de RUT

[`packages/shared`](../../packages/shared/README.md): `parseRut`,
`normalizeRut`, `isValidRut`, `isCanonicalRut`, `computeRutVerifier`,
`formatRut`, `maskRut`. Sin dependencias en tiempo de ejecución. 61 pruebas
unitarias (Vitest), incluida una que comprueba que toda salida normalizada
cumple `app_user_rut_format_chk`.

## 7. Revisión de database-architect (C7, C8, C10)

Revisión completa en
[`docs/database/contract-v1-review.md`](../database/contract-v1-review.md).
backend-architect verificó contra el esquema las afirmaciones en que se apoya
(`delivery_retry_idx`, `notice_ack_once_uq`, restricciones `delivery_*_chk`,
SQLite revisión 2) y aplicó al contrato todos los cambios exigidos.

| Punto | Veredicto | Qué cambió en el contrato |
|---|---|---|
| C7 | Aprobado con cambios | Código `EQUIVALENT_ACK`; `entityId` = acuse existente (≠ `operationId`); `rowVersion: null`; el teléfono no cambia su id local |
| C8 — `UNSUPPORTED_OPERATION` | Aprobado con cambios | `DECLARE_AVAILABILITY` sale `UNSUPPORTED_OPERATION` **guardado**; los tipos desconocidos, solo en auditoría deduplicada y sin payload |
| C8 — `SEQ_CONFLICT` por operación | **Rechazado** | Sale de `SyncResultCode`; pasa a `409 DEVICE_SEQ_CONFLICT` del lote |
| C10 | Aprobado con cambios | Versión de la instantánea = máximo de las dos; cursor sin cambios = el recibido; se quita `mustChangePassword` |
| Sin duplicados al incorporar (§9) | Confirmado con correcciones | Re-armado completo de entregas (§9.2) |
| Varios dispositivos (§10) | Confirmado con precisiones | El re-aviso también se detiene con `OPENED`; revocar borra el token |
| `lateAdditions` | Aprobado con cambios | Regla de integridad referencial de la respuesta (paginación) |
| Token push en el registro de operaciones | Observación exigida | Se guarda solo su hash (`security.md` §4.7) |

### 7.1 C7 — Acuse equivalente

Las restricciones actuales ya lo permiten, sin migración: se guarda una fila
nueva en `sync_operation` con `result = SUPERSEDED`,
`result_code = EQUIVALENT_ACK` y `entity_id` = el acuse existente
(`entity_id` no tiene FK); no se crea nada en `notice_ack`, cuya FK sigue
ligada a la operación original. El código distingue en auditoría "acuse ya
registrado" de "respuesta reemplazada". En el teléfono la clave real es
(`notice_id`, `level`), así que lo marca sincronizado sin tocar su id.

### 7.2 C8 — Operaciones sin fila y colisión de `deviceSeq`

Solo dos casos quedan sin fila en `sync_operation`: un tipo que el modelo no
conoce (lo impide `sync_operation_type_chk`) y un `operationId` que ya es de
otro usuario (lo impide la clave primaria). Ambos van a `audit_log` una sola
vez por `operationId`, con una lista cerrada de metadatos (incluye el hash y el
tamaño del payload, **nunca** el payload: `audit_log` no se puede limpiar y la
retención no está definida). "Nada se pierde en silencio" se cumple porque el
teléfono conserva la operación y su payload, y el usuario ve el motivo. Se
descartaron relajar el CHECK (llenaría la cola de revisión de datos que nadie
sabe interpretar) y una tabla de cuarentena (sobredimensionada para una
brigada).

`SEQ_CONFLICT` como rechazo por operación se rechazó: volvería terminal una
acción real del usuario (por ejemplo, un `VOY`) por un error de numeración
que no es suyo. Ahora es `409 DEVICE_SEQ_CONFLICT` del lote: no se procesa
nada, el teléfono no descarta nada, cambia de `device.id` y reenvía (C15). La
prevención principal es que `device.id` viva solo en la misma fila SQLite que
`next_device_seq` (`device_identity`).

### 7.3 C10 — Perfil como instantánea

Cumple la propiedad P: las dos filas se leen en la misma instantánea de la
descarga y toda escritura posterior recibe una versión mayor que el máximo, así
que avanzar el cursor a ese máximo no salta cambios. La revocación de roles
funciona porque la misma transacción toca `app_user`. `mustChangePassword`
sale de la instantánea porque, con la propuesta H9, su cambio no movería la
versión. El SQLite revisión 2 no puede guardar la instantánea tal cual (exige
columnas de disponibilidad y dos versiones): database-architect hará la
revisión 3 tras aprobarse el contrato. Eso no cambia el contrato.

### 7.4 Correcciones sobre el candado y el re-armado

- El candado de versión no evita **duplicados** (eso lo hace
  `recipient_once_uq`): evita **omisiones** entre una activación y una
  reactivación simultáneas, y solo si la transacción corre en `READ COMMITTED`
  y lee después de tomarlo. En `REPEATABLE READ` la instantánea se fija antes
  de esperar el candado y la garantía se pierde.
- Re-armar no es solo poner `next_attempt_at`: las filas `FAILED` y
  `PROVIDER_DELIVERED` quedan fuera de `delivery_retry_idx` y el worker no las
  vería. Se pasan a `QUEUED` (lo permiten `delivery_failed_chk` y
  `delivery_delivered_chk` limpiando sus fechas), con intentos en 0.

### 7.5 Obligaciones para la etapa 2 (backend)

1. Acuses: comprobación después del candado, un reintento ante `23505`,
   validar que aviso y convocado sean de la misma convocatoria,
   `notice_ack.id = operationId`.
2. Auditoría de operaciones sin fila: deduplicada por `operationId`, lista
   cerrada de metadatos, sin payload.
3. Comprobación de `deviceSeq` del lote antes de procesarlo → `409`.
4. Toda alta o baja de rol toca `app_user` dentro de `replicatedWrite`.
5. `replicatedWrite` siempre en `READ COMMITTED`; prueba de concurrencia entre
   activación y reactivación en ambos órdenes (queda convocado una sola vez).
6. Re-armado en la reactivación como upsert por `delivery_once_uq`.
7. Worker: `FAILED` explícito con `RECIPIENT_INACTIVE`, `NO_TOKEN` y
   `DEVICE_REVOKED`.
8. Re-aviso: se detiene con cualquier acuse o una respuesta.
9. Traspaso de token: quitar y después asignar, en una transacción.
10. `REGISTER_PUSH_TOKEN`: guardar solo el hash del token.

Cada una tendrá su prueba de integración contra PostgreSQL con el rol de la
aplicación.

### 7.6 Propuestas de modelo (opcionales, no bloquean v1)

| Id | Propuesta | Recomendación de database-architect |
|---|---|---|
| H9 | Que el login (`last_login_at`) deje de cambiar la versión de `app_user` | Recomendada (ya estaba pendiente) |
| M1 | Trigger en `user_role` que mueva la versión de `app_user`, dentro de la migración de H9 | Recomendada si se aprueba H9 |
| M2 | Tabla append-only `notification_attempt` (un registro por intento de push) | Opcional: separa los temporizadores de re-aviso y de recibo y conserva cada intento |

Ninguna se escribe ahora; se deciden al iniciar la etapa 2.

## 8. Sincronización offline: garantías

Responde al punto 2 de la revisión del usuario. Cada garantía tiene un
mecanismo en el teléfono, uno en el servidor y una prueba obligatoria en la
etapa 2.

### 8.1 Idempotencia

| Capa | Mecanismo |
|---|---|
| Teléfono | Cada acción crea una operación con un UUID v7 (`operationId`), que es también el `id` de la fila que crea (respuesta, acuse) |
| Servidor | `sync_operation.operation_id` es clave primaria. Si ya existe para el mismo usuario, se devuelve el resultado guardado con `duplicate: true` sin escribir nada; si es de otro usuario, `REJECTED INVALID_PAYLOAD` sin revelar nada |
| Red | Reintentar un lote entero tras un corte, un `5xx` o una respuesta perdida es siempre seguro |
| Prueba | Enviar el mismo lote 3 veces: una sola fila en `sync_operation` y en `emergency_response`; los envíos 2 y 3 responden `duplicate: true` con el mismo resultado |

### 8.2 Operaciones duplicadas

| Caso | Resultado |
|---|---|
| El mismo `operationId` reenviado (red, reinicio de la app) | `duplicate: true`, resultado guardado |
| El mismo lote llega dos veces **a la vez** | Toda operación toma primero el candado de versión: la segunda espera, encuentra la operación guardada y responde `duplicate: true` |
| Mismo `operationId` con otro contenido | Manda el guardado; se registra en auditoría |
| El usuario toca "VOY" dos veces | Son **dos** operaciones con `deviceSeq` distintos: la segunda reemplaza a la primera por orden de `deviceSeq`, sin mirar relojes. Ambas quedan en el historial |
| Acuse equivalente a uno existente con otro `operationId` | C7 (§7) |
| `deviceSeq` repetido con otro `operationId` (base local recreada con el mismo `device.id`) | `409 DEVICE_SEQ_CONFLICT` del lote, **sin procesar nada**: la app genera un `device.id` nuevo, vuelve a iniciar sesión y reenvía las mismas operaciones. Nada queda rechazado (§7.2) |
| El mismo aviso llega dos veces por push (caída del worker tras enviar) | La app descarta el segundo por `noticeId`, y la clave de colapso evita que se vea doble (§9.3) |

### 8.3 Conflictos

| Situación | Regla | Resultado |
|---|---|---|
| Mismo teléfono, varias acciones | Manda `deviceSeq` | La última es la vigente |
| Fuentes distintas (dos teléfonos del mismo brigadista) | `baseRowVersion` detecta que alguien escribió entre medio; se compara `estimatedAt` | Más de 60 s de diferencia: `APPLIED` o `SUPERSEDED`. 60 s o menos: `CONFLICT` (desempate por recepción) y revisión del coordinador |
| Respuesta tomada antes del cierre, llegada después | `estimatedAt` < `closedAt` | Se acepta con `lateSyncAfterClose: true` |
| Respuesta posterior al cierre | `estimatedAt` > `closedAt` | `REJECTED EMERGENCY_CLOSED`, guardada para revisión |
| ±60 s del cierre, o sin hora confiable | — | `CONFLICT LATE_AFTER_CLOSE`, revisión |
| Cuenta desactivada | — | `REJECTED ACCOUNT_INACTIVE` |

`estimatedAt` **no depende solo del reloj del teléfono**: usa el reloj
monotónico (si no hubo reinicio); si no, el desfase medido al enviar; en último
caso, la hora de recepción. Nunca queda en el futuro. Se guardan las tres
horas: declarada, estimada y recibida. Toda decisión es del servidor; el
teléfono adopta el estado vigente al descargar.

### 8.4 Recuperación ante cierres inesperados

| Momento del cierre | Qué pasa | Por qué no se pierde ni se duplica |
|---|---|---|
| Mientras el usuario responde | La fila y su entrada en la cola se escriben en **una** transacción SQLite (`synchronous = FULL`): están las dos o ninguna | Lo confirmado sobrevive a un corte de batería |
| Con la operación en la cola, sin enviar | Al abrir, se envía | Sigue en `PENDING` |
| Durante el envío (`IN_FLIGHT`) | Al abrir, vuelve a `PENDING` y se reenvía | Si el servidor ya la tenía: `duplicate: true` |
| El servidor aplicó pero la respuesta se perdió | Igual que el anterior | Idempotencia por `operationId` |
| El servidor se cae a mitad de un lote | Cada operación es su propia transacción: las confirmadas quedan, las demás no existen | El reintento completa el resto |
| Durante una descarga | El cursor se guarda en la misma transacción que las filas | Se repite desde el último cursor guardado; aplicar dos veces es inofensivo (upsert solo con `rowVersion` mayor) |
| Restauración de un backup del servidor | `syncEpoch` cambia → `epochChanged: true` | El teléfono descarga todo y reenvía sus operaciones de los últimos 7 días (idempotente) |

La persistencia local la implementa mobile-architect según
`docs/database/synchronization/offline-storage.md`; el contrato garantiza que
reenviar siempre es seguro.

## 9. Incorporación durante una convocatoria activa sin notificaciones duplicadas

Responde al punto 3. Casos: alta de un brigadista, reactivación de su cuenta o
de su perfil (C1) y convocado tarde agregado por un coordinador.

### 9.1 Reglas

1. **Una fila de convocado por persona y convocatoria:** `recipient_once_uq`
   (convocatoria × brigadista).
2. **Se notifica solo al crear la fila:** el push del aviso `ACTIVATION` se
   encola únicamente si la fila de convocado se insertó en esa misma
   transacción (`INSERT … ON CONFLICT DO NOTHING RETURNING`). Si ya existía, no
   se encola nada nuevo.
3. **Una entrega por aviso y dispositivo:** `delivery_once_uq`
   (aviso × convocado × canal × dispositivo). El re-aviso (2, 5 y 10 min)
   reutiliza la misma fila; nunca crea otra.
4. **Todo queda en serie:** activar, dar de alta, reactivar y agregar tarde
   toman primero el candado de versión. Dos acciones simultáneas sobre la misma
   persona no pueden crear dos convocados.
5. **Historial:** el convocado queda con `addedReason = LATE_ADDITION` y su
   autor (`addedBy`); la acción y su motivo, en `audit_log`.

### 9.2 Escenarios

| Escenario | Resultado |
|---|---|
| El administrador reactiva a alguien y, a la vez, un coordinador lo agrega tarde | Una sola fila de convocado; la segunda acción encuentra la existente (`200`) y no encola nada |
| Se reactiva a alguien justo mientras se activa la convocatoria | Si la reactivación va primero, la activación lo incluye (`ACTIVATION`); si va después, lo agrega tarde. Nunca las dos. Un solo push por dispositivo |
| El BFF reintenta la reactivación o el agregado tras un corte | Idempotente: misma fila, sin push nuevo |
| Desactivado y reactivado durante la **misma** convocatoria | Conserva su fila (E17); no se crea otra. Si sigue sin responder, se re-arman sus entregas de los avisos que no ha acusado (pasan a `QUEUED`, limpiando `failed_at` y `provider_delivered_at`, con intentos en 0 y el estado anterior en auditoría) y se crean las que falten para dispositivos nuevos. Siempre una por aviso y dispositivo (§7.4) |
| Solo se actualiza el teléfono de contacto del perfil | Nunca convoca ni notifica |
| Ya recibió (`RECEIVED`) o respondió | El re-aviso no vuelve a sonar |

Mientras una cuenta está desactivada, el worker no le envía push: sus entregas
pasan a `FAILED` con `RECIPIENT_INACTIVE` (nunca quedan en un estado que se
confunda con "cancelada por acuse").

### 9.3 Push repetido por el proveedor

El servidor nunca encola dos entregas del mismo aviso al mismo teléfono, pero
la entrega es "al menos una vez": si el worker se cae después de enviar y antes
de guardar el resultado, el mismo push puede salir dos veces. Para que el
usuario no lo vea doble:

- El push lleva `data.noticeId` y una **clave de colapso** igual al `noticeId`
  (etiqueta de notificación en Android, `apns-collapse-id` en iOS): el sistema
  operativo reemplaza la notificación en vez de mostrar dos.
- La app descarta un segundo push con un `noticeId` ya registrado y no crea un
  segundo acuse (`notice_ack_once_uq`).

Requisito para mobile-architect y ui-ux-designer (sonido y vibración del
reemplazo).

## 10. Tokens push con varios dispositivos por brigadista

Responde al punto 4.

| Tema | Regla |
|---|---|
| Registro | Cada teléfono es un `device` con su propio token, registrado con `REGISTER_PUSH_TOKEN` desde la sesión de ese teléfono. Un brigadista puede tener varios (por ejemplo, teléfono personal y de servicio) |
| Envío | Una entrega por convocado × dispositivo no revocado con token `VALID`. Suena en **todos** sus teléfonos; no es un duplicado |
| Antigüedad | No se filtra por `lastSeenAt` (R1): un teléfono que no se abre hace semanas igual recibe, mientras no esté revocado ni con token inválido |
| Acuse y re-aviso | **Cualquier** acuse (`RECEIVED` u `OPENED`) en cualquier dispositivo, o una respuesta, detiene el re-aviso en todos. `OPENED` cuenta porque en iOS el usuario puede abrir la notificación sin que haya `RECEIVED` |
| Panel | La llegada (`reach`) se calcula sobre todos los dispositivos: gana el mejor estado (basta un acuse en uno) |
| Token repetido | `device_push_token_uq` es global. Si el mismo token aparece en otro dispositivo, incluso de otra cuenta (teléfono entregado sin cerrar sesión), se le quita al anterior: un teléfono físico suena para una sola cuenta |
| Token rechazado | `DeviceNotRegistered` del proveedor marca `INVALID` **solo** ese dispositivo; los demás siguen |
| Permisos negados | La app envía `token: null`; el brigadista aparece como `PUSH_DISABLED` en la preparación si ningún otro dispositivo tiene token válido |
| Cerrar sesión (C2) | Borra el token **de ese** dispositivo; los demás siguen recibiendo |
| Sesión vencida (C2) | No borra el token: sigue sonando; al abrir, pide login |
| Teléfono perdido | El brigadista o el administrador revoca ese dispositivo: se borra su token, sin push ni sesiones; sus entregas pendientes pasan a `FAILED` (`DEVICE_REVOKED`); los demás dispositivos no cambian |
| Dispositivo que pierde su token | Por traspaso o permisos negados: sus entregas pendientes pasan a `FAILED` (`NO_TOKEN`); nunca se envían al token de otro dispositivo |
| Token registrado durante una convocatoria activa | No crea entregas: ese teléfono está en línea y descarga la convocatoria por sincronización. Es intencional |
| Traspaso de token | En una transacción: primero se quita al dispositivo anterior y después se asigna; auditoría con los dos dispositivos y usuarios, sin el token |
| Límite de dispositivos | Ninguno en v1. La preparación del panel muestra cuántos tiene cada brigadista |

## 11. Pendientes: lint del contrato y tipos TypeScript

Responde al punto 5. Ninguno de los dos está hecho todavía.

| Pendiente | Estado | Plan |
|---|---|---|
| **Lint con Redocly CLI** | No ejecutado. El entorno bloqueó la descarga de `@redocly/cli` con `npx` (paquete externo que no está instalado en el proyecto). En su lugar se hizo la validación local con Ajv (§5) | Al iniciar la etapa 2: `@redocly/cli` **2.78.0** (versión exacta publicada al 2026-11-13) como dependencia de desarrollo de `backend/`, con `backend/redocly.yaml` (reglas `recommended`, más `operation-operationId-unique` y `no-unused-components`) y el script `npm run openapi:lint`. Todo hallazgo se corrige antes de programar la primera ruta |
| **Tipos con `openapi-typescript`** | No generados | Etapa 2: dependencia exacta **7.13.0** en `backend/`; script `openapi:types` que genera `backend/src/generated/openapi.ts`. Web y mobile los generan desde el mismo YAML al crear sus proyectos |
| Verificación de los tipos | — | Comprobar que los `oneOf` con `discriminator` (operaciones de sync, login) y los `allOf` + `unevaluatedProperties` (páginas, `Emergency`, `UserDetail`) producen tipos utilizables; si alguno no, se ajusta el YAML sin cambiar la forma de los datos |
| Pruebas de contrato | — | Etapa 2: rutas ↔ operaciones (incluidas `x-capabilities`, `x-session-scope`, `x-client`) y validación de cada respuesta contra su esquema |
| CI | — | devops-architect agrega lint y generación de tipos como verificación obligatoria del pipeline del backend |

Si se quiere el lint **antes** de aprobar el contrato, basta con autorizar
`npx @redocly/cli@2.78.0 lint backend/openapi/openapi.yaml`, que no agrega nada
al repositorio.

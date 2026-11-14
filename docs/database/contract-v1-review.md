# Revisión del contrato v1 desde la capa de datos (C7, C8, C10)

> **Estado (2026-11-13): REVISIÓN DE database-architect, PARA APROBACIÓN DEL
> AGENTE PRINCIPAL.** Revisa las decisiones C7, C8 y C10 de
> [`docs/backend/openapi-v1.md`](../backend/openapi-v1.md) §3, la propuesta
> `SEQ_CONFLICT` de [`docs/backend/sync-contract.md`](../backend/sync-contract.md)
> §2.4 y dos afirmaciones de backend-architect sobre los datos (§9 y §10 de la
> guía). No modifica el contrato, el código ni el modelo: todo lo que aquí se
> exige queda como cambio pendiente para su responsable.

Fuentes revisadas: `backend/openapi/openapi.yaml` (`1.0.0-draft.1`),
`backend/prisma/schema.prisma`, `backend/prisma/migrations/20261113000000_init/migration.sql`
y `20261113010000_row_version_positive`, `docs/backend/push-delivery.md`, y en
`docs/database/`: `postgresql/schema.md`, `sqlite/schema.md`,
`synchronization/*.md`, `security.md` y `review-checklist.md` (H9, §5.4).

## 0. Veredictos

| Punto | Veredicto | En una línea |
|---|---|---|
| **C7** — acuse equivalente → `SUPERSEDED` | **APROBADO CON CAMBIOS** | Las restricciones lo permiten tal cual; falta fijar el orden de la comprobación, un `code` que lo distinga y lo que hace el teléfono con un `entityId` distinto |
| **C8** — `UNSUPPORTED_OPERATION` sin fila en `sync_operation` | **APROBADO CON CAMBIOS** | Aceptable solo para tipos que el modelo no conoce, con auditoría sin payload y deduplicada |
| **`SEQ_CONFLICT`** (sync-contract §2.4) como `REJECTED` por operación | **RECHAZADO** | Haría terminal una acción real del usuario (por ejemplo un `VOY`) por un fallo de numeración. Debe ser un error del **lote**, sin que el teléfono descarte nada |
| **C10** — perfil como una instantánea compuesta | **APROBADO CON CAMBIOS** | Cumple la propiedad P; exige definir `rowVersion` = cursor, quitar `mustChangePassword` y una revisión del SQLite |
| **Afirmación 1** — sin notificaciones duplicadas al incorporar | **CONFIRMADA CON CORRECCIONES** | Sin duplicados, sí. Pero "re-armar poniendo `next_attempt_at`" **no funciona** para filas `FAILED` ni `PROVIDER_DELIVERED`: hay que cambiar el estado y crear las filas que falten |
| **Afirmación 2** — varios dispositivos por brigadista | **CONFIRMADA CON PRECISIONES** | Correcta; se precisan el orden del traspaso de token, las entregas del dispositivo que lo pierde y que `OPENED` también detiene el re-aviso |

Ninguna migración es obligatoria para aprobar el contrato. Se proponen dos
(§8.4), ambas opcionales.

---

## 1. C7 — Acuse equivalente con otro `operationId`

### 1.1 Cómo queda registrado

Ejemplo: ya existe el acuse `A` (`notice_ack.id = op1`, `operation_id = op1`)
para (aviso N, convocado R, dispositivo D, `RECEIVED`). Llega `op2` con el mismo
aviso, convocado y nivel desde la sesión de D.

| Tabla | Escritura |
|---|---|
| `sync_operation` | **Una fila nueva**: `operation_id = op2`, `device_id = D`, `user_id`, `device_seq` de op2, `operation_type = 'ACK_NOTICE'`, `payload` tal como llegó (conserva el `via` de op2), `base_row_version = NULL`, `entity_id = A.id` (= op1), `result = 'SUPERSEDED'`, `result_code = 'EQUIVALENT_ACK'` (ver §1.4) |
| `notice_ack` | **Nada** |
| `notification_delivery` | Nada nuevo: el re-aviso ya se canceló con `A` |

### 1.2 ¿Lo permiten las restricciones actuales? Sí

| Restricción | Efecto |
|---|---|
| `sync_operation_pkey` (`operation_id`) | op2 es nueva: no choca |
| `sync_operation_seq_uq` (`device_id`, `device_seq`) | op2 tiene su propio `device_seq`: no choca (si chocara, es §2.4) |
| `sync_operation_type_chk` | `ACK_NOTICE` está admitido |
| `sync_operation_code_chk` | Solo exige `result_code` para `CONFLICT`/`REJECTED`. Con `SUPERSEDED` permite `NULL` **y** permite un código; el código recomendado cabe sin migración |
| `sync_operation.entity_id` | No tiene FK (es polimórfico): puede apuntar al acuse existente |
| `notice_ack_operation_key` (UNIQUE `operation_id`) y FK `notice_ack_operation_id_fkey` | Se refieren a la fila de `A`, que sigue ligada a op1. op2 no crea acuse, así que no hay nada que ligar: la regla "una operación origina **a lo sumo** un acuse" (H4) se cumple |
| `notice_ack_once_uq` | Es justamente lo que se respeta al no insertar |
| `sync_operation_review_idx` | Solo indexa `CONFLICT`/`REJECTED`: el `SUPERSEDED` no ensucia la cola de revisión del coordinador |

Nada se pierde: el `via` distinto de op2 (por ejemplo `SYNC` frente a `PUSH`)
queda en `sync_operation.payload`. Manda el **primer** acuse; su `via` y
`acked_at_device` no cambian (`notice_ack` es append-only).

### 1.3 Concurrencia y orden de escritura

- `sync_operation` es append-only (`sync_operation_append_only`) y debe
  insertarse **antes** que `notice_ack` (lo exige la FK). Por eso el resultado
  tiene que decidirse **antes** de insertar: no se puede insertar `APPLIED` y
  corregir después.
- La comprobación "¿existe ya un acuse equivalente?" (con
  `notice_ack_once_uq` como índice) se hace **después** de tomar el candado de
  versión. El contrato ya dice que toda operación de sync lo toma primero
  (guía §8.2); eso serializa dos acuses equivalentes que lleguen a la vez.
- Red de seguridad: si aun así el `INSERT` en `notice_ack` falla con `23505`
  sobre `notice_ack_once_uq`, se revierte la transacción de esa operación y se
  procesa una vez más (saldrá `SUPERSEDED`).
- Si en el futuro el acuse dejara de tomar el candado de versión (`notice_ack`
  no es replicada; `postgresql/schema.md` §8 no lo exige), la comprobación
  debe hacerse con `SELECT … FOR UPDATE` del `emergency_recipient`.

### 1.4 Coherencia con el SQLite del teléfono

El DDL de `sqlite/schema.md` tiene `UNIQUE (notice_id, level)` en `notice_ack`
(la tabla de `offline-storage.md` §3 dice "U `notice_id`": está desactualizada y
se corregirá). En el teléfono hay un solo dispositivo y un solo convocado por
convocatoria (`emergency_recipient.emergency_id UNIQUE`), así que la clave local
equivale a `notice_ack_once_uq` del servidor. Un teléfono sano **no** genera dos
acuses equivalentes; C7 aparece cuando el teléfono perdió su acuse local y lo
vuelve a crear:

- tras `epochChanged` (backup restaurado) y una descarga completa de un aviso
  que la limpieza local ya había borrado;
- por un error del cliente.

En ambos casos el teléfono tiene su fila local con `id = op2` y el servidor
responde `entityId = op1`. El teléfono **no** debe reescribir su `id` (lo impide
`notice_ack_content_immutable`); solo marca `SYNCED`. Esto debe quedar escrito
en el contrato.

### 1.5 Cambios exigidos (C7)

1. **Contrato:** en `AckNoticeOperation` y `SyncOperationResult`, decir que con
   `SUPERSEDED` de un acuse el `entityId` es el del acuse existente y **puede ser
   distinto** de `operationId`; el teléfono lo da por sincronizado sin cambiar
   su id local. `rowVersion` es `null` (el acuse no es replicado).
2. **Contrato y backend:** agregar el código `EQUIVALENT_ACK` a
   `SyncResultCode` y guardarlo en `sync_operation.result_code`. Distingue en
   auditoría "acuse ya registrado" de "respuesta reemplazada por una más nueva"
   sin cruzar tablas. Cabe en `sync_operation_code_chk` sin migración. El
   teléfono no necesita mostrarlo.
3. **Backend:** comprobación después del candado de versión y reintento único
   ante `23505` en `notice_ack_once_uq` (§1.3).
4. **Backend (integridad que el modelo no expresa):** validar que
   `emergency_notice.emergency_id = emergency_recipient.emergency_id` antes de
   insertar cualquier acuse. `notice_ack` tiene FK a ambos por separado y nada
   impide acusar un aviso de otra convocatoria. Si no coincide:
   `REJECTED NOT_A_RECIPIENT`.
5. **Backend:** `notice_ack.id` = `operationId` siempre (como ya dice
   `offline-storage.md` §3).

---

## 2. C8 — `UNSUPPORTED_OPERATION` y `SEQ_CONFLICT`

### 2.1 Inventario real de operaciones sin fila en `sync_operation`

La guía dice que serían "las únicas". Son **tres**:

| Caso | Por qué no puede tener fila | Tratamiento propuesto |
|---|---|---|
| Tipo desconocido para el **modelo** | `sync_operation_type_chk` | §2.3: solo `audit_log` |
| `deviceSeq` ya usado por otra operación | `sync_operation_seq_uq` | §2.4: error del lote, no rechazo por operación |
| `operationId` que ya existe para **otro** usuario (`REJECTED INVALID_PAYLOAD`, sync-contract §2.2.1) | `sync_operation_pkey` | Solo `audit_log` (posible abuso o error del cliente); ya está en el contrato pero faltaba en la lista |

### 2.2 Alternativas evaluadas

| Alternativa | Evaluación |
|---|---|
| **A. Relajar `sync_operation_type_chk`** | **Descartada.** `sync_operation` es el registro autoritativo que alimentan la revisión del coordinador (`sync_operation_review_idx`) y las resoluciones (`CORRECTED` crea respuestas con `corrects_operation_id`). Filas de tipos desconocidos aparecerían en la cola de revisión con un payload que nadie sabe interpretar. Además no resuelve `SEQ_CONFLICT`, que choca con un `UNIQUE`, no con el `CHECK` |
| **B. Tabla de cuarentena** (`sync_quarantine` con el payload) | **Descartada en el MVP.** Guardaría datos sin validar, de esquema desconocido, sin retención definida (`security.md` §6). El único valor sería el payload, y ese ya lo conserva el teléfono (§2.3). Sobredimensiona para una brigada |
| **C. `audit_log` con metadatos acotados, sin payload** | **Elegida** para tipos desconocidos y para `operationId` ajeno |
| **D. Error del lote para `SEQ_CONFLICT`** | **Elegida** (§2.4) |

### 2.3 `UNSUPPORTED_OPERATION`: aprobado con condiciones

"Nada se pierde en silencio" se cumple porque:

- **El teléfono conserva la acción:** la operación queda `REJECTED` en `outbox`
  con su payload hasta que el usuario la ve (`REJECTED_ACKNOWLEDGED`) y 30 días
  más (`offline-storage.md` §4, trigger `outbox_protect_pending`).
- **El usuario lo ve:** el resultado lleva el motivo.
- **El servidor deja rastro:** una entrada de `audit_log`.

Condiciones:

1. **Solo para tipos que el modelo no conoce.** Un tipo que pasa
   `sync_operation_type_chk` pero que v1 no procesa (hoy
   `DECLARE_AVAILABILITY`) **sí** se guarda en `sync_operation` como
   `REJECTED UNSUPPORTED_OPERATION`. No hay motivo para dejarlo fuera, y no debe
   salir como `INVALID_PAYLOAD` (hoy el `oneOf` del contrato lo haría caer ahí).
2. **Una sola entrada por operación:** `action = 'SYNC_OPERATION_UNSUPPORTED'`,
   `entity_type = 'sync_operation'`, `entity_id = operationId`,
   `actor_user_id` = usuario de la sesión. Antes de insertar se busca por
   (`entity_type`, `entity_id`) con `audit_log_entity_idx`; los reenvíos no
   agregan filas (el teléfono reintenta un lote completo tras un corte).
3. **`audit_log.metadata` no lleva el payload** (§2.5).
4. **No avanza `device.last_device_seq`**: ese número no tiene operación
   guardada.
5. **Despliegue:** el servidor se actualiza **antes** de publicar una app que
   emita un tipo nuevo. `UNSUPPORTED_OPERATION` es una red de seguridad, no el
   camino normal (requisito para devops-architect y mobile-architect).
6. Un reenvío posterior del mismo `operationId` vuelve a evaluarse (no hay fila
   que lo marque como repetido). Si entretanto el servidor ya admite el tipo,
   se aplica. Es aceptable y es mejor que un rechazo permanente; el contrato
   debe decir que `duplicate` es `false` en ese caso.

### 2.4 `SEQ_CONFLICT`: rechazado tal como está propuesto

**Problema.** Con `REJECTED` por operación, la acción queda terminal en el
teléfono ("no reintentar"). Si la colisión viene de una base local recreada con
el mismo `device.id`, **todas** las operaciones nuevas chocan desde
`device_seq = 1`, incluida una respuesta `VOY` en plena emergencia. Se pierde
la acción por un error de numeración que no es culpa del usuario. Esto
contradice R4 y el principio de no perder respuestas.

**Prevención (lo principal).** En `sqlite/schema.md`, `device_id` y
`next_device_seq` viven en la **misma** fila (`device_identity`): si la base se
recrea, ambos nacen juntos y el `device.id` es nuevo. La colisión solo ocurre si
mobile-architect guarda el `device.id` fuera de SQLite (por ejemplo en
SecureStore, que en iOS sobrevive a la reinstalación) o por un error. Se exige
que el `device.id` no se guarde en ningún otro lugar.

**Tratamiento exigido (red de seguridad).**

1. Después del candado de versión, antes de procesar el lote, el servidor
   comprueba cada operación cuyo `operationId` **no** exista: si
   (`device_id`, `device_seq`) ya pertenece a otra operación →
   **`409 DEVICE_SEQ_CONFLICT` para el lote completo**, sin procesar ninguna.
   Una operación cuyo `operationId` ya existe es repetida y no cuenta como
   colisión.
2. Una entrada de `audit_log` por dispositivo y lote
   (`action = 'SYNC_DEVICE_SEQ_CONFLICT'`, `entity_type = 'device'`,
   `entity_id = device_id`, metadatos: `deviceSeq` en conflicto, los dos
   `operationId`). Sin payload.
3. El teléfono **no** marca nada como `REJECTED`: las operaciones siguen
   `PENDING`. La app genera un `device.id` nuevo (actualiza `device_identity`),
   obtiene una sesión para ese dispositivo y reenvía **las mismas**
   operaciones, con los mismos `operationId` y `device_seq`. Con el
   `device_id` nuevo, los números quedan libres en `sync_operation_seq_uq`.
   No hace falta renumerar (`outbox_content_immutable` lo prohíbe y no es
   necesario).
4. La forma de obtener esa sesión (nuevo login como en C13 o un endpoint para
   cambiar de dispositivo) la deciden backend-architect y mobile-architect. Lo
   que la capa de datos exige es: **ninguna operación queda terminal por una
   colisión de `device_seq`**.
5. Respaldo: si el `INSERT` en `sync_operation` falla igualmente con `23505`
   sobre `sync_operation_seq_uq` (carrera no prevista), se revierte la
   operación y el lote responde el mismo `409`.

Con esto, `SEQ_CONFLICT` sale de `SyncResultCode` y pasa a ser un código de
error HTTP del lote.

### 2.5 ¿Puede `audit_log.metadata` llevar el payload? No

| Motivo | Detalle |
|---|---|
| Esquema desconocido | No se puede garantizar que un payload de tipo desconocido no traiga secretos, tokens o un RUT completo (`security.md` §1 y §4.7; comentario de `audit_log.metadata` en `postgresql/schema.md` §7) |
| No se puede limpiar | `audit_log` es append-only (`audit_log_append_only`): lo que entra no se puede tachar después |
| Retención sin definir | `security.md` §6: sin eliminación en el MVP |
| No hace falta | El teléfono conserva el payload original (§2.3) |

**Metadatos permitidos** (lista cerrada): `operationId`, `deviceId`,
`deviceSeq`, `declaredType` (solo si cumple `^[A-Z][A-Z0-9_]{0,63}$`; si no,
`"<invalid>"`), `declaredAt`, `appVersion` (del `device`), `payloadBytes` y
`payloadSha256` (permite cotejar con lo que muestre el teléfono sin guardar el
contenido). Nada más.

### 2.6 Cambios exigidos (C8)

1. **Contrato:** quitar `SEQ_CONFLICT` de `SyncResultCode`; agregar
   `409 DEVICE_SEQ_CONFLICT` a los errores del lote de `/v1/sync/push`, con la
   regla de §2.4 (el teléfono no descarta ni rechaza nada).
2. **Contrato:** `UNSUPPORTED_OPERATION` cubre también los tipos del modelo que
   v1 no procesa (`DECLARE_AVAILABILITY`), y esos **sí** se guardan en
   `sync_operation`. Corregir la garantía 6 de `syncPush` con la lista real de
   §2.1.
3. **Backend:** auditoría deduplicada por `operationId` y con la lista cerrada
   de metadatos de §2.5; sin payload.
4. **Mobile:** `device.id` solo en `device_identity` (misma fila que
   `next_device_seq`); manejo del `409` según §2.4.
5. **Devops:** desplegar el servidor antes que la app cuando aparezca un tipo
   de operación nuevo.

---

## 3. C10 — Perfil como una instantánea compuesta

### 3.1 Propiedad P: se cumple

Consulta del ámbito (sin índice adicional; usa claves primarias y
`brigadista_profile_user_id_key`):

```sql
SELECT … FROM app_user u
LEFT JOIN brigadista_profile b ON b.user_id = u.id
WHERE u.id = :me
  AND (u.row_version > :cursor OR b.row_version > :cursor);
-- cursor nuevo = GREATEST(u.row_version, coalesce(b.row_version, 0))
```

Razonamiento, con la instantánea `REPEATABLE READ READ ONLY` de toda la descarga
(`versioning.md` §4.1):

- Las dos filas se leen en la **misma** instantánea S: la instantánea compuesta
  es coherente (nunca cuenta de un momento y perfil de otro).
- Sea `m` = máximo de las dos versiones vistas. Cualquier transacción que
  escriba después en `app_user` o `brigadista_profile` y no esté en S obtiene
  una versión `w > m`: si fuera `w < m`, por el Lema 2 habría terminado antes
  que la que escribió `m` y S la vería. Por lo tanto, avanzar el cursor a `m`
  nunca salta un cambio de ninguna de las dos tablas.
- Se usa una versión **devuelta** (no `last_value` de la secuencia), como exige
  `versioning.md` §4.2.
- Un perfil de brigadista creado después para un usuario existente recibe una
  versión nueva mayor que el cursor: aparece en la siguiente descarga.
- `hasMore: false` constante es correcto: una sola fila.

Dos precisiones obligatorias:

1. Si no hay cambios (`snapshot: null`), el cursor devuelto es **el que mandó
   el teléfono**, nunca 0 ni la versión actual de otra tabla.
2. `ProfileSnapshot.rowVersion` debe ser exactamente ese máximo (= `cursor`),
   y el contrato debe decir que **no** es la versión de ninguna fila concreta.
   El teléfono guarda la instantánea solo si `rowVersion` > la local. Como `m`
   solo crece (no hay borrados físicos en esas tablas: FK `RESTRICT`), la regla
   de `versioning.md` §4.4 se mantiene.

### 3.2 Revocación y alta de roles

`user_role` no es replicada (sin `row_version` ni trigger) y la revocación es un
borrado físico. Funciona porque:

- La misma transacción hace `DELETE` (o `INSERT`) en `user_role` y un `UPDATE`
  de `app_user`, que dispara `set_row_version` (un trigger `BEFORE UPDATE … FOR
  EACH ROW` se ejecuta aunque el `UPDATE` no cambie ningún valor).
- Ambas escrituras se confirman juntas: S ve las dos o ninguna, y la lista de
  roles que viaja se lee de `user_role` **en la misma instantánea**. El teléfono
  recibe la lista completa, nunca un rol "a medias".

Condiciones:

- Toda alta **y** baja de rol, por cualquier vía (API, semillas, scripts de
  administración), pasa por `replicatedWrite` (candado de versión primero) y
  toca `app_user` en la misma transacción. Prueba de integración obligatoria:
  revocar un rol produce una versión nueva y la siguiente descarga trae la lista
  sin ese rol.
- Si se aprueba H9 (`review-checklist.md` §5.4, opción C), el toque deja de ser
  "cualquier `UPDATE`" y pasa a ser `roles_revision = roles_revision + 1`.

Los roles en el teléfono son solo informativos (`local_user.roles`, "solo para
mostrar"); la autorización se relee en el servidor en cada petición. Un retraso
en la descarga de una revocación no abre ningún permiso.

### 3.3 Interacción con H9: `mustChangePassword` debe salir de la instantánea

`ProfileSnapshot` incluye `mustChangePassword`. Con la propuesta H9, el trigger
de `app_user` solo cambia la versión si cambian `full_name`, `active`,
`deactivated_at` o `roles_revision`. Un cambio de `must_change_password`
**no** produciría versión nueva y el teléfono conservaría un valor viejo sin
saberlo. Además es estado de credenciales, no de perfil: ya lo dicen la
respuesta del login y el alcance de la sesión (`PASSWORD_CHANGE_ONLY`), y un
cambio de contraseña revoca las sesiones.

**Exigido:** quitar `mustChangePassword` de `ProfileSnapshot`. Regla general:
**ningún campo de la instantánea puede quedar fuera del `WHEN` de H9**; si en
el futuro se agrega uno, entra en el `WHEN` en la misma migración.

Campos de la instantánea que quedan, todos replicables: `userId`, `fullName`,
`active`, `roles`, `brigadista.id`, `brigadista.active`, `rowVersion`. Ninguno
es RUT, correo, teléfono ni hash (`security.md` §1).

### 3.4 ¿Puede el SQLite guardarla tal cual? No con la revisión 2

| Problema en `sqlite/schema.md` rev. 2 | Causa |
|---|---|
| `brigadista_profile.availability_status` y `availability_declared_at` son `NOT NULL` | `BrigadistaSelf` no los trae (la disponibilidad está fuera de v1) |
| `brigadista_profile.row_version` y `local_user.row_version` son dos versiones | La instantánea trae una sola |
| `local_user` no tiene `active` ni el `active` del brigadista | La instantánea los trae |

**Solución (cambio en mi documento, pendiente de aprobación; no la hago
ahora):** revisión 3 del SQLite para v1:

- `local_user` agrega `active` y `brigadista_active` (enteros 0/1 con `CHECK`);
  `brigadista_id` ya existe; `row_version` = `ProfileSnapshot.rowVersion`. La
  instantánea se guarda con **un** upsert en una sola fila, sin estados
  mezclados, que es justo lo que C10 busca.
- Las tablas locales `brigadista_profile` y `availability_change` salen de v1 y
  vuelven con la disponibilidad. En ese momento `BrigadistaSelf` agrega los
  campos de disponibilidad y su **propio** `rowVersion` (lo necesitará
  `DECLARE_AVAILABILITY` como `baseRowVersion`). Es un cambio aditivo: no rompe
  el contrato.

### 3.5 Cambios exigidos (C10)

1. **Contrato:** `ProfileSnapshot.rowVersion` = máximo de las dos versiones =
   `ProfileScope.cursor`; con `snapshot: null`, el cursor es el recibido.
2. **Contrato:** quitar `mustChangePassword` de `ProfileSnapshot`.
3. **Backend:** toda alta o baja de rol toca `app_user` dentro de
   `replicatedWrite`, más la prueba de §3.2.
4. **database-architect (yo):** revisión 3 de `sqlite/schema.md` según §3.4,
   tras la aprobación.

---

## 4. Afirmación 1 — Sin notificaciones duplicadas al incorporar brigadistas

### 4.1 Lo que se confirma

| Afirmación | Verificación |
|---|---|
| Una fila de convocado por persona y convocatoria | Correcto: `recipient_once_uq` (`emergency_id`, `brigadista_id`). Esto, **por sí solo**, impide dos convocados aunque no hubiera candado |
| "La convocatoria activa" no es ambigua | `emergency_one_active_uq` garantiza a lo sumo una `ACTIVE` |
| Encolar solo si la fila se insertó | Correcto: `INSERT … ON CONFLICT DO NOTHING RETURNING` devuelve solo las filas realmente insertadas, también en la inserción masiva de la activación |
| Una entrega por aviso y dispositivo | Correcto: `delivery_once_uq` (`notice_id`, `recipient_id`, `channel`, `device_id`) |
| Re-aviso sobre la misma fila | Lo permite `delivery_once_uq`; ver §4.3 sobre cómo |
| El desactivado y reactivado conserva su fila | Correcto: no hay borrado (`ON DELETE RESTRICT` en todas las FK hacia `emergency_recipient`) |

### 4.2 Corrección: qué aporta realmente el candado 7352001

El candado no evita **duplicados** (eso lo hace `recipient_once_uq`); evita
**omisiones**. Sin él, una activación y una reactivación concurrentes podrían
leer cada una el estado anterior de la otra y dejar a la persona sin convocar.
Con él, una de las dos ve a la otra. Pero solo si:

- **Las lecturas se hacen después de tomar el candado y en `READ COMMITTED`**
  (el aislamiento por defecto de PostgreSQL y de las transacciones interactivas
  de Prisma). En `REPEATABLE READ` la instantánea se fija en la **primera
  sentencia**, que es la que toma el candado, **antes** de esperar: la
  transacción no vería lo que confirmó quien tenía el candado, y la garantía se
  pierde. **Exigido:** `replicatedWrite` nunca usa `RepeatableRead` ni
  `Serializable`, y una prueba lo verifica (dos transacciones concurrentes,
  activación y reactivación, en ambos órdenes: la persona siempre queda
  convocada, una sola vez).
- La reactivación consulta la convocatoria `ACTIVE` **después** del candado,
  dentro de la misma transacción.

### 4.3 Corrección: re-armar no es "poner `next_attempt_at`"

**Lo que dicen las restricciones:**

| Estado de la fila | ¿Basta con `next_attempt_at = now()`? | Qué exige el modelo para re-armar |
|---|---|---|
| `QUEUED` / `SENT` / `PROVIDER_ACCEPTED` con `next_attempt_at` nulo (cancelada) | Sí: vuelve a `delivery_retry_idx` | Nada más |
| **`FAILED`** | **No.** `delivery_retry_idx` solo indexa `QUEUED`, `SENT`, `PROVIDER_ACCEPTED`: el worker nunca la ve | `status = 'QUEUED'` **y** `failed_at = NULL` (`delivery_failed_chk`). `provider_delivered_at` ya es nulo. `sent_at` y `provider_accepted_at` pueden quedar (`delivery_sent_chk` y `delivery_accepted_chk` eximen a `QUEUED`) |
| **`PROVIDER_DELIVERED`** (entregado al proveedor antes de la desactivación, sin acuse) | **No**, por la misma razón | `status = 'QUEUED'` **y** `provider_delivered_at = NULL` (`delivery_delivered_chk`) |

Entonces **sí se puede**, sin migración, pero solo cambiando el estado. Y hay
tres consecuencias que el backend debe cubrir:

1. **Se pierde el último resultado.** `failed_at`, `last_error_code`,
   `provider_message_id` y `provider_delivered_at` se sobrescriben. **Exigido:**
   antes de re-armar, una entrada de `audit_log`
   (`action = 'DELIVERY_REARMED'`, `entity_type = 'notification_delivery'`) con
   el estado anterior: `status`, `attempts`, `failed_at`, `last_error_code`,
   `provider_message_id`. Sin token. La alternativa limpia es la tabla de
   intentos (M2, §8.4).
2. **El tope de intentos.** El worker pasa a `FAILED` tras 5 intentos
   (`push-delivery.md` §3). Si `attempts` no se reinicia, la fila re-armada
   vuelve a fallar sin enviar. **Exigido:** `attempts = 0` al re-armar (el valor
   anterior queda en la auditoría).
3. **Faltan filas, no solo hay que re-armar.** Durante la desactivación pudo
   haber avisos `UPDATE` sin entrega para esa persona, y la persona puede tener
   un dispositivo nuevo con token `VALID`. Re-armar solo "sus entregas
   existentes" deja esos avisos sin sonar. **Exigido:** upsert por
   `delivery_once_uq`.

Forma recomendada (ilustrativa; la escribe backend-architect), dentro de la
transacción de reactivación, después del candado:

```sql
INSERT INTO notification_delivery (notice_id, recipient_id, channel, device_id, status, next_attempt_at)
SELECT n.id, r.id, 'PUSH', d.id, 'QUEUED', now()
FROM emergency_recipient r
JOIN emergency e          ON e.id = r.emergency_id AND e.status = 'ACTIVE'
JOIN emergency_notice n   ON n.emergency_id = e.id AND n.kind <> 'CLOSURE'
JOIN brigadista_profile b ON b.id = r.brigadista_id
JOIN device d             ON d.user_id = b.user_id
                         AND d.revoked_at IS NULL
                         AND d.push_token_status = 'VALID'
WHERE r.id = :recipient_id
  AND r.current_response IS NULL                      -- ya respondió: no suena
  AND NOT EXISTS (SELECT 1 FROM notice_ack a          -- notice_ack_recipient_idx
                  WHERE a.recipient_id = r.id AND a.notice_id = n.id)
ON CONFLICT (notice_id, recipient_id, channel, device_id) DO UPDATE
  SET status = 'QUEUED', failed_at = NULL, provider_delivered_at = NULL,
      attempts = 0, last_error_code = NULL, next_attempt_at = now()
  WHERE notification_delivery.status IN ('FAILED', 'PROVIDER_DELIVERED')
     OR notification_delivery.next_attempt_at IS NULL;  -- no toca las que siguen en curso
```

Notas:

- Suena un timbre por aviso sin acuse, el mismo que recibió el resto de la
  brigada; no es un duplicado (cada aviso tiene su clave de colapso). Si se
  prefiere un solo timbre, se limita a la última fila de `emergency_notice` sin
  acuse; lo decide ui-ux-designer.
- La desactivación revoca las sesiones: un teléfono que recibió el push sin
  sesión no pudo acusar. Por eso también se re-arman las `PROVIDER_DELIVERED`.
- **Exigido al worker:** cuando omite una entrega porque la cuenta o el perfil
  están inactivos, la deja en `FAILED` con `last_error_code = 'RECIPIENT_INACTIVE'`.
  No debe quedar `QUEUED` con `next_attempt_at` nulo, un estado que no se
  distingue de "cancelada por acuse".

### 4.4 Observación sobre el re-aviso en general (no bloqueante)

Una sola columna `next_attempt_at` cumple dos funciones: el **re-aviso** (2, 5 y
10 min) y la **consulta del recibo** (`PROVIDER_ACCEPTED` + 15 min,
`push-delivery.md` §3). Además, una fila `PROVIDER_DELIVERED` sale de
`delivery_retry_idx` y el re-aviso tendría que hacerle lo mismo que en §4.3,
borrando `provider_delivered_at`, con lo que el panel pasaría de "entregado al
proveedor" a "enviando". Para el MVP es viable si el worker programa
`next_attempt_at` = el **más próximo** de los dos eventos y decide qué hacer al
despertar, aceptando que el recibo del intento anterior se pierde. Si se quiere
conservar cada intento (pendiente que ya anota `push-delivery.md` §4), hace
falta M2.

---

## 5. Afirmación 2 — Varios dispositivos por brigadista

### 5.1 Lo que se confirma

| Afirmación | Verificación |
|---|---|
| Cada `device` tiene su token; un usuario puede tener varios | Correcto: `device.push_token` por fila; `device_user_idx` (`user_id` WHERE `revoked_at IS NULL`) los lista |
| `device_push_token_uq` es global | Correcto: `UNIQUE (push_token)` sobre toda la tabla. Admite varios `NULL` (`NULLS DISTINCT` por defecto) |
| Una entrega por convocado × dispositivo con token `VALID` | Correcto **por aviso**: `delivery_once_uq` incluye `notice_id` |
| Un acuse en cualquier dispositivo detiene el re-aviso en todos | Correcto: la condición es por convocado y aviso, no por dispositivo; `notice_ack_recipient_idx` (`recipient_id`, `notice_id`, `level`) la resuelve sin mirar `device_id` |

### 5.2 Precisiones exigidas

1. **Orden del traspaso de token.** `device_push_token_uq` no es diferible: en
   la misma transacción, **primero** se quita el token al otro dispositivo
   (`push_token = NULL`, `push_token_status = NULL` juntos por
   `device_token_status_chk`, `push_token_updated_at = now()`) y **después** se
   asigna al de la sesión. Como `REGISTER_PUSH_TOKEN` va por sync y toma el
   candado de versión, dos registros del mismo token quedan en serie; ante un
   `23505` igual se reintenta la operación una vez.
2. **Entregas del dispositivo que pierde el token.** `notification_delivery` no
   guarda el token (bien): el worker lo lee de `device` al enviar. Un
   dispositivo sin token → la entrega pasa a `FAILED` con
   `last_error_code = 'NO_TOKEN'`. Nunca se envía al token "nuevo" del otro
   usuario, porque la fila apunta al `device_id` antiguo. Riesgo residual
   aceptado: si el traspaso ocurre entre que el worker lee el token y llama al
   proveedor, un timbre de la cuenta anterior puede sonar en el teléfono que ya
   usa la otra cuenta. Es inocuo porque el push no lleva datos personales
   (`push-delivery.md` §2) y la convocatoria es de toda la brigada.
3. **Auditoría del traspaso** sin el token (`security.md` §4.7): solo los dos
   `device_id` y los dos `user_id`.
4. **`OPENED` también detiene el re-aviso.** `delivery-and-ack.md` §3 reconoce
   que en iOS puede no haber `RECEIVED` y que el usuario abra la notificación
   directamente. La condición de parada debe ser "existe **cualquier** acuse
   (`RECEIVED` u `OPENED`) del convocado para ese aviso, o una respuesta". Esto
   corrige también mi `delivery-and-ack.md` §5, que solo nombra `RECEIVED`.
5. **Pertenencia del dispositivo.** Nada en el modelo obliga a que
   `notification_delivery.device_id` sea de la misma persona que
   `recipient_id` (no hay FK compuesta posible sin desnormalizar). El backend
   lo garantiza con el `JOIN` de §4.3, y una prueba de integración lo verifica.
6. **Dispositivo revocado.** El worker lo excluye por `revoked_at`, aunque
   conserve el token; sus entregas pendientes pasan a `FAILED`
   (`DEVICE_REVOKED`). Recomendado: al revocar, borrar también el token, para
   que quede libre si el teléfono se reasigna.
7. **Token que llega durante una convocatoria activa.** No crea entregas: ese
   teléfono está en línea y descarga la convocatoria por sync. Correcto, y debe
   quedar escrito para que nadie lo "arregle" agregando un push.

---

## 6. Otros pendientes de `sync-contract.md` §4

| # | Tema | Veredicto |
|---|---|---|
| 1 | Login con `replicatedWrite` (candado primero) | **Aprobado** mientras rija la revisión 2 (es la condición que ya fija `review-checklist.md` §5.4). Con H9 aprobada, el login deja de cambiar la versión y no necesita el candado. Renovación sin candado: **aprobada**; bloquea `app_user` pero no espera el candado, así que no forma ciclo |
| 2 | `SEQ_CONFLICT` | §2.4 |
| 3 | `lateAdditions` | **Aprobado con un cambio.** La regla "convocatoria con `row_version` ≤ cursor" deja un hueco cuando el ámbito `emergencies` se pagina (`hasMore`): un convocado nuevo cuya convocatoria tiene versión **mayor** que el cursor pero quedó fuera de la página no va en `lateAdditions` ni en `emergencies.rows`, y la FK local `emergency_recipient.emergency_id → emergency` hace fallar la transacción SQLite. **Regla exigida:** toda convocatoria referida por una fila de `recipients` (o de `notices`) de la respuesta que **no** esté en `emergencies.rows` de la misma respuesta va completa en `lateAdditions`, sin importar su versión. Repetirla es inofensivo (upsert). El teléfono aplica en orden padre → hijo (`emergencies`, `lateAdditions`, `notices`, `recipients`, `responses`) en una sola transacción |
| 4 | `last_login_at` y `row_version` | Es la propuesta H9 (opción C), que sigue pendiente de aprobación; la recomiendo. §3.3 agrega la regla sobre los campos de la instantánea |

---

## 7. Observaciones fuera de lo pedido

1. **El token push en `sync_operation.payload`.** `REGISTER_PUSH_TOKEN` guardaría
   el token completo en una tabla append-only, contra `security.md` §4.7
   ("ningún payload contiene tokens") y el comentario "sin secretos" de
   `sync_operation.payload`. **Exigido:** guardar en el payload solo
   `{ "tokenSha256": …, "cleared": true|false }`. El token vive solo en
   `device.push_token`.
2. **Tamaño de payloads `INVALID_PAYLOAD`.** Se guardan tal como llegaron
   (hasta 256 KiB por lote) en una tabla que no se puede limpiar. Recomendado:
   si el payload supera 16 KiB, guardar `{ "truncated": true, "bytes": …,
   "sha256": … }`.
3. **Documentos míos desactualizados** (los corrijo tras la aprobación):
   `postgresql/schema.md` §8 dice que un acuse del mismo nivel es "repetido"
   (ahora es `SUPERSEDED`, C7); `offline-storage.md` §3 dice "U `notice_id`"
   (es `notice_id`, `level`); `delivery-and-ack.md` §5 (parada también por
   `OPENED`).

---

## 8. Lista consolidada de cambios exigidos

### 8.1 Contrato OpenAPI (backend-architect)

1. C7: documentar `entityId` ≠ `operationId` en `SUPERSEDED` de un acuse; el
   teléfono no cambia su id local; `rowVersion: null`.
2. C7: agregar `EQUIVALENT_ACK` a `SyncResultCode`.
3. C8: quitar `SEQ_CONFLICT` de `SyncResultCode`; agregar
   `409 DEVICE_SEQ_CONFLICT` al lote de `/v1/sync/push` (ninguna operación queda
   terminal).
4. C8: `UNSUPPORTED_OPERATION` también para `DECLARE_AVAILABILITY` en v1
   (guardada en `sync_operation`), no `INVALID_PAYLOAD`; corregir la garantía 6
   con los casos de §2.1; `duplicate: false` al reevaluar un tipo desconocido.
5. C10: `ProfileSnapshot.rowVersion` = máximo = `cursor`; cursor sin cambios =
   el recibido.
6. C10: quitar `mustChangePassword` de `ProfileSnapshot`.
7. `lateAdditions`: regla de cierre referencial de §6.3.

### 8.2 Comportamiento del backend (backend-architect)

1. Acuses: comprobación después del candado; reintento único ante `23505` en
   `notice_ack_once_uq`; validar aviso y convocado de la misma convocatoria;
   `notice_ack.id = operationId`.
2. Auditoría de rechazos sin fila: deduplicada por `operationId`, con la lista
   cerrada de metadatos de §2.5, sin payload; también para `operationId` ajeno.
3. `SEQ_CONFLICT`: comprobación previa del lote y `409` (§2.4).
4. Roles: toda alta o baja toca `app_user` dentro de `replicatedWrite`, con su
   prueba.
5. `replicatedWrite` siempre en `READ COMMITTED`, con lecturas después del
   candado, y la prueba de concurrencia de §4.2.
6. Re-armado en la reactivación: upsert de §4.3 (estado `QUEUED`, limpiar
   `failed_at`/`provider_delivered_at`, `attempts = 0`), con auditoría previa
   del estado anterior.
7. Worker: `FAILED` explícito con `RECIPIENT_INACTIVE`, `NO_TOKEN` y
   `DEVICE_REVOKED`; nunca filas en curso con `next_attempt_at` nulo salvo por
   cancelación tras acuse o respuesta.
8. Re-aviso: parar con cualquier acuse (`RECEIVED` u `OPENED`) o una respuesta.
9. Traspaso de token: quitar primero y asignar después, en una transacción;
   auditoría sin token.
10. `REGISTER_PUSH_TOKEN`: payload guardado sin el token (§7.1).

### 8.3 Mobile (mobile-architect)

1. `device.id` solo en `device_identity`, junto a `next_device_seq`.
2. Ante `409 DEVICE_SEQ_CONFLICT`: `device.id` nuevo, sesión nueva y reenvío de
   las mismas operaciones, sin marcar ninguna como rechazada.
3. Ante `SUPERSEDED` de un acuse con otro `entityId`: marcar `SYNCED` sin
   cambiar el id local.

### 8.4 Modelo de datos: propuestas de migración (opcionales; no se escriben ahora)

| Id | Propuesta | Motivo | Prioridad |
|---|---|---|---|
| **M1** | Dentro de la migración de H9: trigger `AFTER INSERT OR DELETE ON user_role FOR EACH ROW` que haga `UPDATE app_user SET roles_revision = roles_revision + 1 WHERE id = …` | Ninguna vía (script, semilla, error) puede olvidar el toque de roles de §3.2. El backend sigue tomando el candado primero; el trigger es la red | Recomendada si se aprueba H9 |
| **M2** | Tabla `notification_attempt` (`delivery_id`, número de intento, `sent_at`, `provider_message_id`, estado del ticket y del recibo, `receipt_due_at`, error), append-only, sin token. `notification_delivery` queda como resumen por aviso y dispositivo, con `next_attempt_at` solo para el re-aviso | Separa los dos temporizadores (§4.4), conserva cada intento y vuelve innecesaria la auditoría de §4.3.1 | Opcional; no bloquea v1 |

### 8.5 Documentación de database-architect (tras la aprobación)

1. `sqlite/schema.md` revisión 3 (§3.4).
2. `postgresql/schema.md` §8, `offline-storage.md` §3 y `delivery-and-ack.md`
   §5 (§7.3).
3. `security.md` §6: al definir la retención, incluir las entradas de
   `audit_log` de §2.

### 8.6 Otros

- devops-architect: el servidor se despliega antes que una app con tipos de
  operación nuevos (§2.3.5).
- ui-ux-designer: un timbre por aviso sin acuse o solo por el último, en la
  reactivación (§4.3).

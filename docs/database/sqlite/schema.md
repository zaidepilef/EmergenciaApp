# SQLite (teléfono) — DDL de referencia (revisión 3)

> **PROPUESTA PARA AUDITORÍA. No es una migración.** La implementará
> mobile-architect con `expo-sqlite` y migraciones versionadas con
> `PRAGMA user_version`, solo con autorización expresa.
>
> Réplica **parcial y propia** del brigadista + cola de operaciones, alineada
> con el contrato OpenAPI v1 aprobado (`backend/openapi/openapi.yaml`,
> versión 1.0.0). Sin RUT, sin hashes, sin datos de otros brigadistas. Los
> tokens de sesión (acceso y renovación) van en SecureStore, nunca aquí (el token
> push es un caso aparte: §5.4).
>
> La revisión 3 aplica `contract-v1-review.md` §3.4 y §8.3. Registro de cambios
> en §8. Como `mobile/` aún no existe, la revisión 3 es la primera que se
> implementará: no hay migración desde la revisión 2.

## 1. Configuración de la conexión

```sql
PRAGMA journal_mode = WAL;    -- escrituras atómicas y lecturas concurrentes
PRAGMA synchronous  = FULL;   -- durabilidad ante corte de batería
PRAGMA foreign_keys = ON;     -- obligatorio en cada conexión
```

Fechas: texto ISO-8601 UTC de largo fijo `YYYY-MM-DDTHH:MM:SS.sssZ`
(`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`); el orden alfabético es el cronológico.
Es el mismo formato de `Timestamp` en el contrato.

## 2. Tablas (9)

```sql
-- Identidad del dispositivo. ÚNICO lugar donde vive device.id (§5.5).
CREATE TABLE device_identity (
  singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
  device_id       TEXT    NOT NULL,                    -- DeviceRegistration.id (UUID v7)
  next_device_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_device_seq >= 1),
  sync_epoch      TEXT,                                -- SyncPullResponse.syncEpoch; NULL antes de la 1.ª descarga
  created_at      TEXT    NOT NULL
);

-- Instantánea de perfil (ProfileSnapshot): cuenta + perfil de brigadista en UNA fila.
CREATE TABLE local_user (
  singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id           TEXT    NOT NULL,                  -- userId
  full_name         TEXT    NOT NULL,                  -- fullName
  active            INTEGER NOT NULL CHECK (active IN (0, 1)),             -- active
  roles             TEXT    NOT NULL DEFAULT '[]'
                    CHECK (json_valid(roles) AND json_type(roles) = 'array'), -- roles; solo para mostrar
  brigadista_id     TEXT,                              -- brigadista.id   (NULL si brigadista = null)
  brigadista_active INTEGER CHECK (brigadista_active IN (0, 1)),          -- brigadista.active
  row_version       INTEGER NOT NULL CHECK (row_version >= 0),            -- rowVersion (máximo de las dos)
  CHECK ((brigadista_id IS NULL) = (brigadista_active IS NULL))
);

CREATE TABLE emergency (
  id             TEXT    PRIMARY KEY,
  emergency_type TEXT    NOT NULL,
  meeting_point  TEXT    NOT NULL,
  scheduled_at   TEXT    NOT NULL,
  instructions   TEXT,
  status         TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),  -- nunca borradores
  activated_at   TEXT    NOT NULL,
  closed_at      TEXT,
  row_version    INTEGER NOT NULL,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE INDEX emergency_purge_idx ON emergency (status, closed_at);

CREATE TABLE emergency_notice (
  id           TEXT    PRIMARY KEY,
  emergency_id TEXT    NOT NULL REFERENCES emergency (id) ON DELETE CASCADE,
  -- Conocidos en v1: ACTIVATION, UPDATE, CLOSURE, REOPEN (este último no se emite).
  -- El contrato exige tolerar valores desconocidos: no se restringe a la lista (§3.2).
  kind         TEXT    NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  message      TEXT,
  created_at   TEXT    NOT NULL,
  row_version  INTEGER NOT NULL
);
CREATE INDEX emergency_notice_idx ON emergency_notice (emergency_id, created_at);

-- Bandeja interna propia: una fila por convocatoria en que figura.
CREATE TABLE emergency_recipient (
  id                  TEXT    PRIMARY KEY,
  emergency_id        TEXT    NOT NULL UNIQUE REFERENCES emergency (id) ON DELETE CASCADE,
  added_reason        TEXT    NOT NULL CHECK (added_reason IN ('ACTIVATION', 'LATE_ADDITION')),
  convoked_at         TEXT    NOT NULL,
  current_response    TEXT    CHECK (current_response IN ('VOY', 'NO_PUEDO')),
  current_response_id TEXT,   -- sin FK: la respuesta puede llegar en una página posterior (§4.4)
  responded_at        TEXT,
  row_version         INTEGER NOT NULL,
  CHECK ((current_response IS NULL) = (current_response_id IS NULL))
);

CREATE TABLE emergency_response (
  id                    TEXT    PRIMARY KEY,           -- = operation_id si es propia
  recipient_id          TEXT    NOT NULL REFERENCES emergency_recipient (id) ON DELETE CASCADE,
  response              TEXT    NOT NULL CHECK (response IN ('VOY', 'NO_PUEDO')),
  source                TEXT    NOT NULL CHECK (source IN ('APP', 'WEB', 'COORDINATOR_PROXY')),
  declared_at           TEXT    NOT NULL,
  declared_monotonic_ms INTEGER,
  boot_session_id       TEXT,
  device_seq            INTEGER,                       -- NULL si llegó por descarga desde otra fuente
  sync_status           TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED')),
  sync_result           TEXT    CHECK (sync_result IN ('APPLIED', 'SUPERSEDED', 'CONFLICT')),
  late_sync_after_close INTEGER NOT NULL DEFAULT 0 CHECK (late_sync_after_close IN (0, 1)),
  estimated_at          TEXT,
  received_at           TEXT,
  row_version           INTEGER
);
CREATE INDEX emergency_response_idx ON emergency_response (recipient_id, declared_at DESC);

-- Acuses propios: RECEIVED y OPENED, cada uno a lo sumo una vez por aviso.
-- (notice_id, level) equivale en el teléfono a notice_ack_once_uq del servidor.
CREATE TABLE notice_ack (
  id          TEXT    PRIMARY KEY,                     -- = operation_id; nunca cambia (§5.2)
  notice_id   TEXT    NOT NULL REFERENCES emergency_notice (id) ON DELETE CASCADE,
  level       TEXT    NOT NULL CHECK (level IN ('RECEIVED', 'OPENED')),
  via         TEXT    CHECK (via IN ('PUSH', 'SYNC')),
  acked_at    TEXT    NOT NULL,
  sync_status TEXT    NOT NULL DEFAULT 'PENDING'
              CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED')),
  UNIQUE (notice_id, level),
  CHECK ((level = 'RECEIVED') = (via IS NOT NULL))
);

-- Cola persistente de operaciones. Cada fila es exactamente una SyncOperation.
CREATE TABLE outbox (
  operation_id          TEXT    PRIMARY KEY,           -- operationId
  device_seq            INTEGER NOT NULL UNIQUE,       -- deviceSeq
  operation_type        TEXT    NOT NULL CHECK (operation_type IN
                          ('RESPOND_EMERGENCY', 'ACK_NOTICE', 'REGISTER_PUSH_TOKEN')),  -- type (v1)
  entity_id             TEXT    NOT NULL,              -- = operation_id en los tres tipos de v1 (§5.5)
  emergency_id          TEXT    REFERENCES emergency (id) ON DELETE RESTRICT,  -- protege la limpieza; NULL en tokens
  payload               TEXT    NOT NULL CHECK (json_valid(payload)),          -- payload, tal como se enviará
  base_row_version      INTEGER,                       -- baseRowVersion
  declared_at           TEXT    NOT NULL,              -- declaredAt
  declared_monotonic_ms INTEGER,                       -- declaredMonotonicMs
  boot_session_id       TEXT,                          -- bootSessionId
  created_offline       INTEGER NOT NULL CHECK (created_offline IN (0, 1)),   -- createdOffline
  state                 TEXT    NOT NULL DEFAULT 'PENDING' CHECK (state IN
                          ('PENDING', 'IN_FLIGHT', 'APPLIED', 'REJECTED', 'REJECTED_ACKNOWLEDGED')),
  attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at       TEXT,
  last_error            TEXT,
  applied_at            TEXT,                          -- confirmada por el servidor (§5.1)
  rejected_code         TEXT,                          -- code del resultado REJECTED
  rejected_at           TEXT,
  acknowledged_at       TEXT,
  created_at            TEXT    NOT NULL,
  -- Solo RESPOND_EMERGENCY lleva baseRowVersion (los otros esquemas no lo admiten).
  CHECK ((operation_type = 'RESPOND_EMERGENCY') = (base_row_version IS NOT NULL)),
  CHECK ((state = 'APPLIED') = (applied_at IS NOT NULL)),
  CHECK ((state IN ('REJECTED', 'REJECTED_ACKNOWLEDGED')) = (rejected_at IS NOT NULL)),
  CHECK ((state = 'REJECTED_ACKNOWLEDGED') = (acknowledged_at IS NOT NULL))
);
CREATE INDEX outbox_send_idx ON outbox (state, device_seq);

-- Un cursor por ámbito de SyncCursors.
CREATE TABLE sync_state (
  scope           TEXT    PRIMARY KEY
                  CHECK (scope IN ('profile', 'emergencies', 'notices', 'recipients', 'responses')),
  cursor          INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  last_success_at TEXT
);
```

Las cinco filas de `sync_state` se crean junto con la base, con `cursor = 0`.

## 3. Correspondencia con el contrato v1

Cada campo de las respuestas de sincronización tiene su columna o una razón
para no guardarse. La app ignora campos que no conozca (lo exige
`SyncPullResponse`).

### 3.1 `ProfileScope` / `ProfileSnapshot` → `local_user`

| Campo del contrato | Columna | Nota |
|---|---|---|
| `userId` | `user_id` | No cambia mientras exista la base (trigger `local_user_same_user`, §6) |
| `fullName` | `full_name` | |
| `active` | `active` | Cuenta activa |
| `roles` | `roles` | Arreglo JSON de `AppRole`; lista completa, solo informativa |
| `brigadista` (`null`) | `brigadista_id = NULL`, `brigadista_active = NULL` | Usuario sin perfil de brigadista |
| `brigadista.id` | `brigadista_id` | |
| `brigadista.active` | `brigadista_active` | |
| `rowVersion` | `row_version` | Máximo de las versiones de cuenta y perfil; **no** es la versión de una fila. Se guarda solo si es mayor que la local |
| `ProfileScope.cursor` | `sync_state('profile').cursor` | Igual a `rowVersion` si hubo instantánea; si `snapshot` es `null`, es el cursor enviado (no cambia) |
| `ProfileScope.hasMore` | — | Siempre `false` |

No hay columnas de disponibilidad: la disponibilidad está fuera del MVP y
`BrigadistaSelf` no la trae. Tampoco `mustChangePassword`: no viaja en la
instantánea; el estado de la contraseña lo dicen el login, `/v1/me` y el
alcance de la sesión, y la app no lo persiste aquí.

Si la app crea `local_user` con los datos de `/v1/me` antes de la primera
descarga (por ejemplo, para mostrar el nombre), usa `row_version = 0`: así la
primera instantánea siempre la reemplaza.

### 3.2 `SyncEmergency`, `SyncNotice`, `LateAddition`

| Esquema | Tabla | Nota |
|---|---|---|
| `SyncEmergency` (todos sus campos) | `emergency` | Uno a uno. `instructions` y `closedAt` admiten `NULL` |
| `SyncNotice` (todos sus campos) | `emergency_notice` | `kind` se guarda tal cual aunque la app no lo conozca (`NoticeKind`: "la app debe tolerar valores que no conozca"); la interfaz lo muestra como aviso genérico |
| `LateAddition.emergency` | `emergency` | Mismo upsert que `emergencies.rows` |
| `LateAddition.notices` | `emergency_notice` | Mismo upsert que `notices.rows` |

### 3.3 `SyncRecipient` → `emergency_recipient`

Uno a uno: `id`, `emergencyId`, `addedReason`, `convokedAt`,
`currentResponse`, `currentResponseId`, `respondedAt` y `rowVersion`.
`current_response_id` no tiene FK: la respuesta vigente se aplica después del
convocado (§4.1) y puede llegar en una página posterior.

### 3.4 `SyncResponse` → `emergency_response`

| Campo | Columna | Nota |
|---|---|---|
| `id`, `recipientId`, `response`, `source`, `declaredAt` | mismas | Inmutables (trigger) |
| `estimatedAt`, `receivedAt`, `lateSyncAfterClose`, `rowVersion` | mismas | Las fija el servidor |
| `syncResult` | `sync_result` | `APPLIED`, `SUPERSEDED` o `CONFLICT`; la fila queda `sync_status = 'SYNCED'` |
| `timeConfidence` | — | **No se guarda en v1**: ninguna pantalla del teléfono lo usa |
| `deviceId` | — | **No se guarda**: el teléfono no guarda identificadores de dispositivo fuera de `device_identity` (§5.5). Lo propio se reconoce por `device_seq` no nulo |

Si algún día una pantalla necesita `timeConfidence`, se agrega una columna
nula; es un cambio aditivo.

### 3.5 `SyncOperation` → `outbox`

| Campo del contrato | Columna |
|---|---|
| `operationId` | `operation_id` |
| `deviceSeq` | `device_seq` |
| `type` | `operation_type` (solo los tres tipos de v1; `DECLARE_AVAILABILITY` sale de la lista local porque la app v1 no lo emite) |
| `declaredAt`, `declaredMonotonicMs`, `bootSessionId` | `declared_at`, `declared_monotonic_ms`, `boot_session_id` |
| `createdOffline` | `created_offline` (nuevo en la revisión 3: el contrato lo exige) |
| `baseRowVersion` | `base_row_version`, solo en `RESPOND_EMERGENCY` (= `row_version` local del convocado al responder) |
| `payload` | `payload`, exactamente el objeto del esquema: `{recipientId, response}`; `{noticeId, recipientId, level, via}` o `{noticeId, recipientId, level}`; `{token}` |

`SyncClock` no se guarda: se calcula al armar cada lote.

## 4. Aplicar una descarga

### 4.1 Orden padre → hijo, en una sola transacción

Toda la respuesta de `/v1/sync/pull` se aplica en **una** transacción SQLite,
en este orden (regla 4 de `syncPull`):

1. `scopes.profile` → `local_user` (independiente de los demás).
2. `scopes.emergencies.rows` → `emergency`.
3. `lateAdditions` → `emergency` y luego sus `notices` → `emergency_notice`.
4. `scopes.notices.rows` → `emergency_notice`.
5. `scopes.recipients.rows` → `emergency_recipient`.
6. `scopes.responses.rows` → `emergency_response`.
7. Los cinco cursores en `sync_state`, `device_identity.sync_epoch` y
   `last_success_at`.

Si algo falla, se revierte todo y el cursor no avanza: la descarga se repite
desde el último cursor guardado. Aplicarla dos veces es inofensivo.

### 4.2 Upsert solo con versión mayor

Cada fila se aplica con upsert por `id` **solo si** su `rowVersion` es mayor
que la local (`versioning.md` §4). Ilustrativo:

```sql
INSERT INTO emergency (id, emergency_type, meeting_point, scheduled_at, instructions,
                       status, activated_at, closed_at, row_version)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  emergency_type = excluded.emergency_type, meeting_point = excluded.meeting_point,
  scheduled_at = excluded.scheduled_at, instructions = excluded.instructions,
  status = excluded.status, activated_at = excluded.activated_at,
  closed_at = excluded.closed_at, row_version = excluded.row_version
WHERE excluded.row_version > emergency.row_version;

INSERT INTO local_user (singleton, user_id, full_name, active, roles,
                        brigadista_id, brigadista_active, row_version)
VALUES (1, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (singleton) DO UPDATE SET
  full_name = excluded.full_name, active = excluded.active, roles = excluded.roles,
  brigadista_id = excluded.brigadista_id, brigadista_active = excluded.brigadista_active,
  row_version = excluded.row_version
WHERE excluded.row_version > local_user.row_version;
```

La instantánea de perfil se guarda con **un** upsert en una sola fila: nunca
queda cuenta de un momento y perfil de otro.

**Respuestas propias.** Una `SyncResponse` puede ser una respuesta que este
teléfono creó (mismo `id`). El `DO UPDATE` **no** debe incluir columnas
protegidas por `response_content_immutable`: en SQLite un trigger
`BEFORE UPDATE OF col` se dispara si la columna está en el `SET`, aunque el
valor no cambie. Solo se actualizan las columnas de estado:

```sql
INSERT INTO emergency_response (id, recipient_id, response, source, declared_at,
                                sync_status, sync_result, late_sync_after_close,
                                estimated_at, received_at, row_version)
VALUES (?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  sync_status = 'SYNCED', sync_result = excluded.sync_result,
  late_sync_after_close = excluded.late_sync_after_close,
  estimated_at = excluded.estimated_at, received_at = excluded.received_at,
  row_version = excluded.row_version
WHERE emergency_response.row_version IS NULL
   OR excluded.row_version > emergency_response.row_version;
```

Si la respuesta propia aún está en `outbox` (el servidor la aplicó pero la
respuesta del envío se perdió), la operación sigue pendiente y se reenvía: el
servidor responde `duplicate: true`.

### 4.3 Cursores por ámbito

| Ámbito | Cursor que se guarda |
|---|---|
| `profile` | `ProfileScope.cursor` (= `snapshot.rowVersion`, o el enviado si `snapshot` es `null`) |
| `emergencies`, `notices`, `recipients`, `responses` | `cursor` de su ámbito, salvo el caso de §4.4 |

Las filas de `lateAdditions` **no** mueven ningún cursor: su versión puede ser
mayor que el cursor de `emergencies` y la convocatoria volverá a llegar por su
ámbito (upsert inofensivo). Si algún ámbito trae `hasMore: true`, se repite la
llamada con los cursores nuevos.

Con `epochChanged: true`, en la misma transacción y **antes** de aplicar las
filas:

1. Todas las versiones locales pasan a 0 (`UPDATE … SET row_version = 0` en
   `local_user`, `emergency`, `emergency_notice`, `emergency_recipient` y en
   `emergency_response` donde no sea `NULL`). Al restaurar un backup la
   secuencia del servidor vuelve atrás: sin este paso, una fila local con una
   versión de la época anterior, mayor que la restaurada, rechazaría el dato
   vigente del servidor en esta página y en las siguientes.
2. No se borra ninguna fila local: el teléfono no sabe cuáles perdió el
   servidor, y las propias son justamente las que se reenvían.
3. Se aplican las filas (§4.1), los cinco cursores se reemplazan por los de la
   respuesta (el servidor ignoró los enviados y descargó desde 0) y se guarda
   el `syncEpoch` nuevo.
4. Las operaciones `APPLIED` de los últimos 7 días vuelven a `PENDING`
   (`applied_at = NULL`) para reenviarse sin cambios (§5.1).

### 4.4 Fila hija sin su padre (red de seguridad)

La regla 4 del contrato asegura que toda convocatoria referida por `notices` o
`recipients` venga en la misma respuesta. **No** cubre el convocado referido
por una fila de `responses` (hueco reportado a backend-architect; no se
corrige aquí): con `recipients` paginado, una respuesta puede llegar antes que
su convocado (la respuesta vigente sube la versión del convocado por encima de
la de la respuesta) y la FK `emergency_response.recipient_id` haría fallar toda
la transacción, una y otra vez.

Mientras el contrato no lo cubra, la app aplica esta regla, válida para
cualquier ámbito hijo (`notices`, `recipients`, `responses`):

1. Las filas de un ámbito vienen en orden de `rowVersion` ascendente.
2. Si una fila no tiene su padre (ni local ni en esta respuesta), se dejan de
   aplicar esa fila y las siguientes **de ese ámbito**, y su cursor se guarda
   como `rowVersion` de esa fila − 1 (las versiones son enteros únicos de una
   secuencia global). El resto de la descarga se aplica normalmente.
3. La siguiente llamada vuelve a pedir desde esa fila. Como el ámbito padre
   avanza (`hasMore: true`), el padre llega y la fila se aplica.
4. Si el ámbito padre ya no tiene `hasMore` y la fila sigue huérfana, es un
   error del servidor: la app no repite en bucle; lo registra y reintenta en la
   siguiente sincronización normal.

Nunca se pierde una fila: el cursor no la salta.

## 5. Resultados del envío

### 5.1 Confirmación

Tras una respuesta de `/v1/sync/push`, por cada `SyncOperationResult`, en una
sola transacción:

| `result` | Registro local | `outbox` |
|---|---|---|
| `APPLIED`, `SUPERSEDED`, `CONFLICT` | `sync_status = 'SYNCED'`, `sync_result` (en respuestas) | `state = 'APPLIED'`, `applied_at = now` |
| `REJECTED` | `sync_status = 'REJECTED'` | `state = 'REJECTED'`, `rejected_code = code`, `rejected_at = now` |

Una operación `APPLIED` **no se borra de inmediato**: se conserva 7 días. Es la
copia exacta (mismos `operationId`, `deviceSeq`, payload y horas) que se reenvía
si el servidor restaura un backup (`epochChanged`, E13). El trigger
`outbox_protect_pending` (§6) impide borrarla antes.

### 5.2 `SUPERSEDED EQUIVALENT_ACK`

Solo en `ACK_NOTICE`. El servidor ya tenía un acuse equivalente con otro
`operationId`; `entityId` es el id de **ese** acuse y `rowVersion` es `null`.
El teléfono:

- marca su `notice_ack` como `SYNCED` y la operación como `APPLIED`;
- **no** cambia `notice_ack.id` (lo impide `notice_ack_content_immutable`);
- no guarda el `entityId` recibido ni lo muestra.

La clave real del acuse en el teléfono es (`notice_id`, `level`); el id local
solo identifica la operación.

En general, el teléfono **nunca** reescribe ids locales con el `entityId` de un
resultado.

### 5.3 `REJECTED`

Sin cambios respecto de `offline-storage.md` §4: se muestra el motivo
(`rejected_code`) hasta que el usuario lo confirma y se conserva 30 días más.
`UNSUPPORTED_OPERATION` se trata igual que cualquier otro rechazo.

### 5.4 Token push en `outbox`

`REGISTER_PUSH_TOKEN` guarda el token Expo en `outbox.payload` (`{token}`):
hace falta para que un cambio de token sin conexión no se pierda (así lo pide
el contrato). Es el único lugar del SQLite donde aparece, y sale al borrarse la
operación (7 días después de `APPLIED`, o 30 días después de confirmar un
rechazo). No es un token de sesión; los de sesión siguen solo en SecureStore.

### 5.5 `device.id` y `409 DEVICE_SEQ_CONFLICT` (C15)

**Prevención.** `device.id` vive **solo** en `device_identity.device_id`, en la
misma fila que `next_device_seq`. No se guarda en SecureStore, en
almacenamiento clave-valor ni en otra tabla (por eso `outbox.entity_id` de
`REGISTER_PUSH_TOKEN` es el `operation_id` y no el id del dispositivo, y
`SyncResponse.deviceId` no se guarda). Si la base se recrea, el id y el
contador nacen juntos y el id es nuevo. El id que devuelve `/v1/me`
(`session.deviceId`) debe coincidir con el guardado.

**Tratamiento del `409 DEVICE_SEQ_CONFLICT`** (el servidor no procesó nada del
lote):

1. En una transacción: `UPDATE device_identity SET device_id = <UUID v7 nuevo>`
   y las operaciones `IN_FLIGHT` del lote vuelven a `PENDING`. **Nada** pasa a
   `REJECTED`, nada se borra y `next_device_seq` **no** se reinicia (trigger
   `device_seq_never_back`, §6).
2. La app inicia sesión de nuevo con el `device.id` nuevo. **No** es un cierre
   de sesión: la base local y la cola se conservan (`security.md` §5 borra la
   base solo al cerrar sesión).
3. Reenvía **las mismas** operaciones, con los mismos `operationId` y
   `device_seq` (`outbox_content_immutable` impide renumerar, y no hace falta:
   con el `device_id` nuevo los números quedan libres en el servidor).

El mismo cambio de `device_id` sirve cuando el login responde
`409 DEVICE_ID_CONFLICT` o `403 DEVICE_REVOKED` ("la app genera un `device.id`
nuevo y reintenta").

## 6. Protecciones con triggers

### Inmutabilidad de lo que el usuario hizo

El contenido de una operación y del registro que creó no cambia nunca; solo
cambian sus columnas de estado de sincronización.

```sql
CREATE TRIGGER outbox_content_immutable
BEFORE UPDATE OF operation_id, device_seq, operation_type, entity_id, emergency_id,
                 payload, base_row_version, declared_at, declared_monotonic_ms,
                 boot_session_id, created_offline, created_at ON outbox
BEGIN SELECT RAISE(ABORT, 'el contenido de una operación es inmutable'); END;

CREATE TRIGGER response_content_immutable
BEFORE UPDATE OF id, recipient_id, response, source, declared_at,
                 declared_monotonic_ms, boot_session_id, device_seq ON emergency_response
BEGIN SELECT RAISE(ABORT, 'respuesta inmutable'); END;

CREATE TRIGGER notice_ack_content_immutable
BEFORE UPDATE OF id, notice_id, level, via, acked_at ON notice_ack
BEGIN SELECT RAISE(ABORT, 'acuse inmutable'); END;
```

### Identidad

```sql
-- La base local es de un solo usuario; otro usuario implica cerrar sesión y recrearla.
CREATE TRIGGER local_user_same_user
BEFORE UPDATE OF user_id ON local_user WHEN NEW.user_id <> OLD.user_id
BEGIN SELECT RAISE(ABORT, 'la base local pertenece a otro usuario'); END;

-- El contador nunca retrocede, aunque cambie device_id (§5.5).
CREATE TRIGGER device_seq_never_back
BEFORE UPDATE OF next_device_seq ON device_identity
WHEN NEW.next_device_seq < OLD.next_device_seq
BEGIN SELECT RAISE(ABORT, 'next_device_seq no puede retroceder'); END;
```

### Limpieza protegida

```sql
CREATE TRIGGER emergency_protect_active
BEFORE DELETE ON emergency WHEN OLD.status = 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'convocatoria activa'); END;

CREATE TRIGGER response_protect_unsynced
BEFORE DELETE ON emergency_response WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'respuesta sin sincronizar'); END;

CREATE TRIGGER notice_ack_protect_unsynced
BEFORE DELETE ON notice_ack WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'acuse sin sincronizar'); END;

-- Se borran solo APPLIED de más de 7 días o REJECTED_ACKNOWLEDGED.
CREATE TRIGGER outbox_protect_pending
BEFORE DELETE ON outbox
WHEN OLD.state IN ('PENDING', 'IN_FLIGHT', 'REJECTED')
  OR (OLD.state = 'APPLIED'
      AND OLD.applied_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'))
BEGIN SELECT RAISE(ABORT, 'operación pendiente, reciente o rechazada sin revisar'); END;
```

Los triggers se activan también en borrados en cascada desde `emergency`.

## 7. Limpieza local (Q9)

Una convocatoria a la vez, para que una protección que aborte no detenga las demás:

```sql
SELECT id FROM emergency e
WHERE e.status = 'CLOSED'
  AND e.closed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.emergency_id = e.id);

-- Por cada candidata, en su propia transacción:
DELETE FROM emergency WHERE id = ?;   -- cascada a avisos, convocado, respuestas y acuses
```

Tres barreras: la consulta, la FK `RESTRICT` de `outbox` y los triggers.

- `outbox` `APPLIED`: se borran 7 días después de `applied_at`.
- `outbox` `REJECTED_ACKNOWLEDGED`: se borran 30 días después de `acknowledged_at`.
- Registros propios `SYNCED`: se conservan al menos 7 días (reenvío tras
  restauración del servidor, E13); con la convocatoria cerrada hace más de 30
  días, ya se cumple.

## 8. Registro de cambios

### Revisión 3 (2026-11-14) — alineación con el contrato v1 aprobado

| # | Cambio | Motivo |
|---|---|---|
| 1 | `local_user` agrega `active` y `brigadista_active` (0/1); `row_version` = `ProfileSnapshot.rowVersion`; `roles` debe ser un arreglo JSON | C10: la instantánea se guarda tal cual en una fila (`contract-v1-review.md` §3.4) |
| 2 | Salen `brigadista_profile` y `availability_change`, sus triggers y su limpieza | Disponibilidad fuera del MVP; `BrigadistaSelf` no trae sus campos y la instantánea trae una sola versión |
| 3 | `sync_state`: sale el ámbito `availability`; quedan los cinco de `SyncCursors`; `cursor >= 0` | Cursores por ámbito del contrato |
| 4 | `outbox.operation_type` sin `DECLARE_AVAILABILITY` | La app v1 no lo emite |
| 5 | `outbox.created_offline` (y en `outbox_content_immutable`) | `SyncOperationBase.createdOffline` es obligatorio y faltaba |
| 6 | `CHECK`: `base_row_version` solo y siempre en `RESPOND_EMERGENCY` | Los otros esquemas no admiten `baseRowVersion` (`unevaluatedProperties: false`) |
| 7 | `outbox.applied_at`; las `APPLIED` se conservan 7 días; `outbox_protect_pending` lo exige | El reenvío de `epochChanged` necesita la operación exacta; antes se borraba al confirmarse y no podía reconstruirse (los acuses no guardaban `device_seq` ni horas) |
| 8 | `emergency_recipient` agrega `added_reason` y `current_response_id` (sin FK), con `CHECK` de nulidad conjunta | Campos obligatorios de `SyncRecipient` que no tenían columna |
| 9 | `emergency_notice.kind` acepta valores desconocidos | `NoticeKind` exige tolerarlos; con el `CHECK` anterior un valor nuevo abortaba la descarga |
| 10 | Orden padre → hijo en una transacción y red de seguridad para filas huérfanas (§4) | Regla 4 de `syncPull` (`lateAdditions`) y hueco de `responses` → `recipients` (§4.4) |
| 11 | `SUPERSEDED EQUIVALENT_ACK` sin cambiar el id local (§5.2) | C7 |
| 12 | `device.id` solo en `device_identity`; manejo de `409 DEVICE_SEQ_CONFLICT`; triggers `device_seq_never_back` y `local_user_same_user` (§5.5, §6) | C8 y C15 |
| 13 | `SyncResponse.timeConfidence` y `deviceId` no se guardan (§3.4) | Sin uso en el teléfono v1; regla de `device.id` |
| 14 | Upsert de respuestas propias solo sobre columnas de estado (§4.2) | Evitar que `response_content_immutable` aborte la descarga |
| 15 | Con `epochChanged`, versiones locales a 0 antes de aplicar (§4.3) | La secuencia del servidor retrocede al restaurar; la regla "solo si es mayor" rechazaría el dato restaurado |

**Vuelven con la disponibilidad (después del MVP):** `brigadista_profile`,
`availability_change`, el ámbito `availability` y `DECLARE_AVAILABILITY` en la
cola. `BrigadistaSelf` agregará sus campos y su propio `rowVersion` (cambio
aditivo del contrato).

### Revisión 2

DDL auditado el 2026-11-13 (`review-checklist.md` §1–4).

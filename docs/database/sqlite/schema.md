# SQLite (teléfono) — DDL de referencia

> **PROPUESTA PARA REVISIÓN. No es una migración.** La implementará
> mobile-architect con `expo-sqlite` y migraciones versionadas con
> `PRAGMA user_version`.
>
> Réplica **parcial y propia** del brigadista + cola de operaciones. Sin RUT, sin
> hashes, sin datos de otros brigadistas. Los tokens de sesión van en
> SecureStore, nunca aquí.

## 1. Configuración de la conexión

```sql
PRAGMA journal_mode = WAL;    -- escrituras atómicas y lecturas concurrentes
PRAGMA synchronous  = FULL;   -- durabilidad ante corte de batería: prioriza no perder la cola
PRAGMA foreign_keys = ON;     -- obligatorio en cada conexión (SQLite lo desactiva por defecto)
```

Formato de fechas: texto ISO-8601 UTC de largo fijo `YYYY-MM-DDTHH:MM:SS.sssZ`
(lo que produce `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`). El orden alfabético
coincide con el cronológico.

## 2. Tablas

```sql
-- Identidad de esta instalación y secuencia de operaciones (una fila).
CREATE TABLE device_identity (
  singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
  device_id       TEXT    NOT NULL,                   -- UUID v7 generado al instalar
  next_device_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_device_seq >= 1),
  sync_epoch      TEXT,                               -- época del servidor conocida
  created_at      TEXT    NOT NULL
);

CREATE TABLE local_user (
  singleton     INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id       TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  roles         TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(roles)),  -- solo para mostrar
  brigadista_id TEXT,                                  -- NULL si no es brigadista
  row_version   INTEGER NOT NULL
);

CREATE TABLE brigadista_profile (
  id                       TEXT    PRIMARY KEY,
  active                   INTEGER NOT NULL CHECK (active IN (0, 1)),
  availability_status      TEXT    NOT NULL
                           CHECK (availability_status IN ('DISPONIBLE', 'NO_DISPONIBLE', 'EN_SERVICIO')),
  availability_declared_at TEXT    NOT NULL,
  row_version              INTEGER NOT NULL
);

CREATE TABLE availability_change (
  id                    TEXT    PRIMARY KEY,           -- = operation_id
  brigadista_id         TEXT    NOT NULL REFERENCES brigadista_profile (id),
  status                TEXT    NOT NULL
                        CHECK (status IN ('DISPONIBLE', 'NO_DISPONIBLE', 'EN_SERVICIO')),
  declared_at           TEXT    NOT NULL,
  declared_monotonic_ms INTEGER,                       -- reloj monotónico, si está disponible
  boot_session_id       TEXT,                          -- identifica el arranque del teléfono
  device_seq            INTEGER,
  sync_status           TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED')),
  estimated_at          TEXT,                          -- lo devuelve el servidor
  received_at           TEXT,
  row_version           INTEGER                        -- NULL hasta sincronizar
);
CREATE INDEX availability_change_time_idx ON availability_change (declared_at DESC);

CREATE TABLE emergency (
  id             TEXT    PRIMARY KEY,
  emergency_type TEXT    NOT NULL,
  meeting_point  TEXT    NOT NULL,
  scheduled_at   TEXT    NOT NULL,
  instructions   TEXT,
  status         TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),  -- el teléfono no recibe borradores
  activated_at   TEXT    NOT NULL,
  closed_at      TEXT,
  row_version    INTEGER NOT NULL,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE INDEX emergency_purge_idx ON emergency (status, closed_at);

CREATE TABLE emergency_notice (
  id           TEXT    PRIMARY KEY,
  emergency_id TEXT    NOT NULL REFERENCES emergency (id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('ACTIVATION', 'UPDATE', 'CLOSURE', 'REOPEN')),
  message      TEXT,
  created_at   TEXT    NOT NULL,
  row_version  INTEGER NOT NULL
);
CREATE INDEX emergency_notice_idx ON emergency_notice (emergency_id, created_at);

CREATE TABLE emergency_recipient (
  id               TEXT    PRIMARY KEY,
  emergency_id     TEXT    NOT NULL UNIQUE REFERENCES emergency (id) ON DELETE CASCADE,  -- una por convocatoria
  convoked_at      TEXT    NOT NULL,
  current_response TEXT    CHECK (current_response IN ('VOY', 'NO_PUEDO')),
  responded_at     TEXT,
  first_seen_at    TEXT,
  row_version      INTEGER NOT NULL
);

CREATE TABLE emergency_response (
  id                    TEXT    PRIMARY KEY,           -- = operation_id si nació aquí
  recipient_id          TEXT    NOT NULL REFERENCES emergency_recipient (id) ON DELETE CASCADE,
  response              TEXT    NOT NULL CHECK (response IN ('VOY', 'NO_PUEDO')),
  source                TEXT    NOT NULL CHECK (source IN ('APP', 'WEB', 'COORDINATOR_PROXY')),
  declared_at           TEXT    NOT NULL,
  declared_monotonic_ms INTEGER,
  boot_session_id       TEXT,
  device_seq            INTEGER,
  sync_status           TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED')),
  late_sync_after_close INTEGER NOT NULL DEFAULT 0 CHECK (late_sync_after_close IN (0, 1)),
  estimated_at          TEXT,
  received_at           TEXT,
  row_version           INTEGER
);
CREATE INDEX emergency_response_idx ON emergency_response (recipient_id, declared_at DESC);

-- Acuse local: evita reenviar el acuse de un aviso ya confirmado.
CREATE TABLE notice_ack (
  id           TEXT    PRIMARY KEY,                    -- = operation_id
  notice_id    TEXT    NOT NULL UNIQUE REFERENCES emergency_notice (id) ON DELETE CASCADE,
  via          TEXT    NOT NULL CHECK (via IN ('PUSH', 'INBOX')),
  acked_at     TEXT    NOT NULL,
  sync_status  TEXT    NOT NULL DEFAULT 'PENDING'
               CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED'))
);

-- Cola persistente de operaciones (puntos 1, 2 y 4 de la revisión).
CREATE TABLE outbox (
  operation_id          TEXT    PRIMARY KEY,
  device_seq            INTEGER NOT NULL UNIQUE,
  operation_type        TEXT    NOT NULL CHECK (operation_type IN
                          ('DECLARE_AVAILABILITY', 'RESPOND_EMERGENCY', 'ACK_NOTICE', 'REGISTER_PUSH_TOKEN')),
  entity_id             TEXT    NOT NULL,
  emergency_id          TEXT    REFERENCES emergency (id) ON DELETE RESTRICT,  -- protege la limpieza (punto 6)
  payload               TEXT    NOT NULL CHECK (json_valid(payload)),
  base_row_version      INTEGER,
  declared_at           TEXT    NOT NULL,
  declared_monotonic_ms INTEGER,
  boot_session_id       TEXT,
  state                 TEXT    NOT NULL DEFAULT 'PENDING' CHECK (state IN
                          ('PENDING', 'IN_FLIGHT', 'APPLIED', 'REJECTED', 'REJECTED_ACKNOWLEDGED')),
  attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at       TEXT,
  last_error            TEXT,
  rejected_code         TEXT,
  rejected_at           TEXT,
  acknowledged_at       TEXT,
  created_at            TEXT    NOT NULL,
  CHECK ((state IN ('REJECTED', 'REJECTED_ACKNOWLEDGED')) = (rejected_at IS NOT NULL)),
  CHECK ((state = 'REJECTED_ACKNOWLEDGED') = (acknowledged_at IS NOT NULL))
);
CREATE INDEX outbox_send_idx ON outbox (state, device_seq);

CREATE TABLE sync_state (
  scope           TEXT    PRIMARY KEY
                  CHECK (scope IN ('profile', 'availability', 'emergencies', 'notices', 'recipients', 'responses')),
  cursor          INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT
);
```

Las operaciones aplicadas por el servidor se **eliminan** de `outbox`; el
registro queda en su tabla con `sync_status = 'SYNCED'`. Las rechazadas
**permanecen** (ver `../synchronization/offline-storage.md`).

## 3. Protecciones con triggers

```sql
-- Nunca borrar una convocatoria activa.
CREATE TRIGGER emergency_protect_active
BEFORE DELETE ON emergency WHEN OLD.status = 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'convocatoria activa'); END;

-- Nunca borrar datos propios no confirmados por el servidor (también si el
-- borrado viene en cascada desde emergency).
CREATE TRIGGER response_protect_unsynced
BEFORE DELETE ON emergency_response WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'respuesta sin sincronizar'); END;

CREATE TRIGGER availability_protect_unsynced
BEFORE DELETE ON availability_change WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'disponibilidad sin sincronizar'); END;

CREATE TRIGGER notice_ack_protect_unsynced
BEFORE DELETE ON notice_ack WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'acuse sin sincronizar'); END;

-- Una operación pendiente no se puede borrar: solo pasa a otro estado.
CREATE TRIGGER outbox_protect_pending
BEFORE DELETE ON outbox WHEN OLD.state IN ('PENDING', 'IN_FLIGHT', 'REJECTED')
BEGIN SELECT RAISE(ABORT, 'operación pendiente o rechazada sin revisar'); END;
```

Tras una respuesta `APPLIED` del servidor, en una sola transacción: la fila pasa a
`sync_status = 'SYNCED'`, la operación a `state = 'APPLIED'` y luego se borra. El
trigger solo permite borrar operaciones `APPLIED` o `REJECTED_ACKNOWLEDGED`.

## 4. Limpieza local (Q9 y punto 6)

Se ejecuta **una convocatoria a la vez**, para que una protección que aborte no
detenga la limpieza de las demás:

```sql
-- Candidatas: cerradas hace más de 30 días y sin operaciones en la cola.
SELECT id FROM emergency e
WHERE e.status = 'CLOSED'
  AND e.closed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.emergency_id = e.id);

-- Por cada candidata, en su propia transacción:
DELETE FROM emergency WHERE id = ?;   -- cascada a avisos, convocado, respuestas y acuses
```

Garantías, de afuera hacia adentro:

1. La consulta excluye activas y con operaciones en cola.
2. La FK `outbox.emergency_id ... ON DELETE RESTRICT` impide el borrado si hay
   operaciones pendientes o rechazadas sin cerrar.
3. Los triggers abortan si la convocatoria está activa o si alguna fila hija no
   está sincronizada.

Historial de disponibilidad: se eliminan filas `SYNCED` con `declared_at` de más
de 30 días; las demás quedan protegidas por el trigger.

`REJECTED_ACKNOWLEDGED` se elimina 30 días después de `acknowledged_at`; recién
entonces su convocatoria puede limpiarse.

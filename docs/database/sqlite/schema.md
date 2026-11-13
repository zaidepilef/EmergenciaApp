# SQLite (teléfono) — DDL de referencia (revisión 2)

> **PROPUESTA PARA AUDITORÍA. No es una migración.** La implementará
> mobile-architect con `expo-sqlite` y migraciones versionadas con
> `PRAGMA user_version`, solo con autorización expresa.
>
> Réplica **parcial y propia** del brigadista + cola de operaciones. Sin RUT, sin
> hashes, sin datos de otros brigadistas. Tokens en SecureStore, nunca aquí.

## 1. Configuración de la conexión

```sql
PRAGMA journal_mode = WAL;    -- escrituras atómicas y lecturas concurrentes
PRAGMA synchronous  = FULL;   -- durabilidad ante corte de batería
PRAGMA foreign_keys = ON;     -- obligatorio en cada conexión
```

Fechas: texto ISO-8601 UTC de largo fijo `YYYY-MM-DDTHH:MM:SS.sssZ`
(`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`); el orden alfabético es el cronológico.

## 2. Tablas (11)

```sql
CREATE TABLE device_identity (
  singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
  device_id       TEXT    NOT NULL,
  next_device_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_device_seq >= 1),
  sync_epoch      TEXT,
  created_at      TEXT    NOT NULL
);

CREATE TABLE local_user (
  singleton     INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id       TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  roles         TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(roles)),  -- solo para mostrar
  brigadista_id TEXT,
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
  declared_monotonic_ms INTEGER,
  boot_session_id       TEXT,
  device_seq            INTEGER,
  sync_status           TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED')),
  sync_result           TEXT    CHECK (sync_result IN ('APPLIED', 'SUPERSEDED', 'CONFLICT')),
  estimated_at          TEXT,
  received_at           TEXT,
  row_version           INTEGER
);
CREATE INDEX availability_change_time_idx ON availability_change (declared_at DESC);

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
  kind         TEXT    NOT NULL CHECK (kind IN ('ACTIVATION', 'UPDATE', 'CLOSURE', 'REOPEN')),
  message      TEXT,
  created_at   TEXT    NOT NULL,
  row_version  INTEGER NOT NULL
);
CREATE INDEX emergency_notice_idx ON emergency_notice (emergency_id, created_at);

-- Bandeja interna propia: una fila por convocatoria en que figura.
CREATE TABLE emergency_recipient (
  id               TEXT    PRIMARY KEY,
  emergency_id     TEXT    NOT NULL UNIQUE REFERENCES emergency (id) ON DELETE CASCADE,
  convoked_at      TEXT    NOT NULL,
  current_response TEXT    CHECK (current_response IN ('VOY', 'NO_PUEDO')),
  responded_at     TEXT,
  row_version      INTEGER NOT NULL
);

CREATE TABLE emergency_response (
  id                    TEXT    PRIMARY KEY,
  recipient_id          TEXT    NOT NULL REFERENCES emergency_recipient (id) ON DELETE CASCADE,
  response              TEXT    NOT NULL CHECK (response IN ('VOY', 'NO_PUEDO')),
  source                TEXT    NOT NULL CHECK (source IN ('APP', 'WEB', 'COORDINATOR_PROXY')),
  declared_at           TEXT    NOT NULL,
  declared_monotonic_ms INTEGER,
  boot_session_id       TEXT,
  device_seq            INTEGER,
  sync_status           TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED')),
  sync_result           TEXT    CHECK (sync_result IN ('APPLIED', 'SUPERSEDED', 'CONFLICT')),
  late_sync_after_close INTEGER NOT NULL DEFAULT 0 CHECK (late_sync_after_close IN (0, 1)),
  estimated_at          TEXT,
  received_at           TEXT,
  row_version           INTEGER
);
CREATE INDEX emergency_response_idx ON emergency_response (recipient_id, declared_at DESC);

-- Acuses propios (punto 4): RECEIVED y OPENED, cada uno a lo sumo una vez.
CREATE TABLE notice_ack (
  id          TEXT    PRIMARY KEY,                     -- = operation_id
  notice_id   TEXT    NOT NULL REFERENCES emergency_notice (id) ON DELETE CASCADE,
  level       TEXT    NOT NULL CHECK (level IN ('RECEIVED', 'OPENED')),
  via         TEXT    CHECK (via IN ('PUSH', 'SYNC')),
  acked_at    TEXT    NOT NULL,
  sync_status TEXT    NOT NULL DEFAULT 'PENDING'
              CHECK (sync_status IN ('PENDING', 'SYNCED', 'REJECTED')),
  UNIQUE (notice_id, level),
  CHECK ((level = 'RECEIVED') = (via IS NOT NULL))
);

-- Cola persistente de operaciones.
CREATE TABLE outbox (
  operation_id          TEXT    PRIMARY KEY,
  device_seq            INTEGER NOT NULL UNIQUE,
  operation_type        TEXT    NOT NULL CHECK (operation_type IN
                          ('DECLARE_AVAILABILITY', 'RESPOND_EMERGENCY', 'ACK_NOTICE', 'REGISTER_PUSH_TOKEN')),
  entity_id             TEXT    NOT NULL,
  emergency_id          TEXT    REFERENCES emergency (id) ON DELETE RESTRICT,  -- protege la limpieza
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

## 3. Protecciones con triggers

### Inmutabilidad de lo que el usuario hizo (punto 2 de la revisión)

El contenido de una operación y del registro que creó no cambia nunca; solo
cambian sus columnas de estado de sincronización.

```sql
CREATE TRIGGER outbox_content_immutable
BEFORE UPDATE OF operation_id, device_seq, operation_type, entity_id, emergency_id,
                 payload, base_row_version, declared_at, declared_monotonic_ms,
                 boot_session_id, created_at ON outbox
BEGIN SELECT RAISE(ABORT, 'el contenido de una operación es inmutable'); END;

CREATE TRIGGER response_content_immutable
BEFORE UPDATE OF id, recipient_id, response, source, declared_at,
                 declared_monotonic_ms, boot_session_id, device_seq ON emergency_response
BEGIN SELECT RAISE(ABORT, 'respuesta inmutable'); END;

CREATE TRIGGER availability_content_immutable
BEFORE UPDATE OF id, brigadista_id, status, declared_at,
                 declared_monotonic_ms, boot_session_id, device_seq ON availability_change
BEGIN SELECT RAISE(ABORT, 'declaración inmutable'); END;

CREATE TRIGGER notice_ack_content_immutable
BEFORE UPDATE OF id, notice_id, level, via, acked_at ON notice_ack
BEGIN SELECT RAISE(ABORT, 'acuse inmutable'); END;
```

### Limpieza protegida (punto 6)

```sql
CREATE TRIGGER emergency_protect_active
BEFORE DELETE ON emergency WHEN OLD.status = 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'convocatoria activa'); END;

CREATE TRIGGER response_protect_unsynced
BEFORE DELETE ON emergency_response WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'respuesta sin sincronizar'); END;

CREATE TRIGGER availability_protect_unsynced
BEFORE DELETE ON availability_change WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'disponibilidad sin sincronizar'); END;

CREATE TRIGGER notice_ack_protect_unsynced
BEFORE DELETE ON notice_ack WHEN OLD.sync_status <> 'SYNCED'
BEGIN SELECT RAISE(ABORT, 'acuse sin sincronizar'); END;

-- Solo se borran operaciones APPLIED o REJECTED_ACKNOWLEDGED.
CREATE TRIGGER outbox_protect_pending
BEFORE DELETE ON outbox WHEN OLD.state IN ('PENDING', 'IN_FLIGHT', 'REJECTED')
BEGIN SELECT RAISE(ABORT, 'operación pendiente o rechazada sin revisar'); END;
```

Tras una respuesta del servidor que confirma la operación (`APPLIED`,
`SUPERSEDED` o `CONFLICT`), en una sola transacción: el registro pasa a
`sync_status = 'SYNCED'` con su `sync_result`, la operación a
`state = 'APPLIED'` y luego se borra.

Los triggers se activan también en borrados en cascada desde `emergency`.

## 4. Limpieza local (Q9)

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

- Historial de disponibilidad: se borran filas `SYNCED` de más de 30 días.
- `REJECTED_ACKNOWLEDGED`: se borran 30 días después de `acknowledged_at`.
- Registros propios `SYNCED`: se conservan al menos 7 días (reenvío tras
  restauración del servidor, E13).

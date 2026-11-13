# PostgreSQL — DDL de referencia

> **PROPUESTA PARA REVISIÓN. No es una migración** y no debe ejecutarse. Se
> traducirá a `schema.prisma` + SQL manual cuando el usuario lo autorice.
> PostgreSQL 18. Todas las fechas en UTC (`timestamptz(3)`).

## 1. Enumeraciones

```sql
CREATE TYPE app_role            AS ENUM ('ADMINISTRADOR', 'COORDINADOR');
CREATE TYPE availability_status AS ENUM ('DISPONIBLE', 'NO_DISPONIBLE', 'EN_SERVICIO');
CREATE TYPE emergency_status    AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');
CREATE TYPE notice_kind         AS ENUM ('ACTIVATION', 'UPDATE', 'CLOSURE', 'REOPEN');
CREATE TYPE response_value      AS ENUM ('VOY', 'NO_PUEDO');
CREATE TYPE action_source       AS ENUM ('APP', 'WEB', 'COORDINATOR_PROXY');
CREATE TYPE contact_channel     AS ENUM ('APP', 'PHONE_CALL', 'RADIO', 'IN_PERSON', 'OTHER');
CREATE TYPE contact_outcome     AS ENUM ('ANSWERED', 'NO_ANSWER', 'MESSAGE_LEFT');
CREATE TYPE recipient_reason    AS ENUM ('ACTIVATION', 'LATE_ADDITION');
CREATE TYPE delivery_channel    AS ENUM ('PUSH');
CREATE TYPE delivery_status     AS ENUM ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED',
                                         'DEVICE_RECEIVED', 'OPENED', 'FAILED');
CREATE TYPE ack_via             AS ENUM ('PUSH', 'INBOX');
CREATE TYPE device_platform     AS ENUM ('ANDROID', 'IOS');
CREATE TYPE push_token_status   AS ENUM ('VALID', 'INVALID');
CREATE TYPE client_type         AS ENUM ('MOBILE', 'WEB');
CREATE TYPE time_confidence     AS ENUM ('MONOTONIC', 'CLOCK_OFFSET', 'SERVER_RECEIPT', 'HUMAN_DECLARED');
CREATE TYPE sync_result         AS ENUM ('APPLIED', 'SUPERSEDED', 'CONFLICT', 'REJECTED');
CREATE TYPE resolution_status   AS ENUM ('NONE', 'PENDING_REVIEW', 'RESOLVED');
CREATE TYPE attendance_event    AS ENUM ('ARRIVED', 'LEFT');  -- condicional P2
```

## 2. Mecanismos comunes

```sql
-- Versión de fila para la sincronización incremental.
CREATE SEQUENCE sync_row_version_seq AS bigint;

CREATE FUNCTION set_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- El candado dura hasta el fin de la transacción: las versiones se confirman
  -- en el mismo orden en que se asignan, así un cursor nunca salta una fila.
  -- Costo aceptable: las escrituras sobre tablas replicadas son pocas.
  PERFORM pg_advisory_xact_lock(hashtext('sync_row_version'));
  NEW.row_version := nextval('sync_row_version_seq');
  RETURN NEW;
END $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es append-only', TG_TABLE_NAME;
END $$;
```

Aplicación:

- `set_row_version`: `BEFORE INSERT OR UPDATE` en `app_user`, `user_role`,
  `brigadista_profile`, `availability_change`, `emergency`, `emergency_notice`,
  `emergency_recipient`, `emergency_response`.
- `touch_updated_at`: `BEFORE UPDATE` en las tablas con `updated_at`.
- `forbid_mutation`: `BEFORE UPDATE OR DELETE` en `availability_change`,
  `emergency_notice`, `emergency_response`, `notice_ack`, `manual_contact`,
  `emergency_attendance`, `audit_log`.

El rol de base de datos de la aplicación no recibe `DELETE` sobre ninguna tabla
ni `UPDATE` sobre las append-only (segunda barrera además del trigger).

## 3. Identidad, permisos y sesiones

```sql
CREATE TABLE app_user (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  rut                  text NOT NULL UNIQUE,            -- canónico 12345678-5
  password_hash        text NOT NULL,                   -- Argon2id
  full_name            text NOT NULL,
  email                text,
  active               boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  password_expires_at  timestamptz(3),                  -- contraseña provisoria (Q6)
  password_changed_at  timestamptz(3),
  last_login_at        timestamptz(3),
  deactivated_at       timestamptz(3),
  deactivated_by       uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  created_at           timestamptz(3) NOT NULL DEFAULT now(),
  updated_at           timestamptz(3) NOT NULL DEFAULT now(),
  row_version          bigint NOT NULL,
  CONSTRAINT app_user_rut_format_chk CHECK (rut ~ '^[1-9][0-9]{0,7}-[0-9K]$'),  -- el dígito verificador lo valida el backend
  CONSTRAINT app_user_deactivation_chk CHECK (active OR deactivated_at IS NOT NULL),
  CONSTRAINT app_user_provisional_chk CHECK (password_expires_at IS NULL OR must_change_password)
);
CREATE UNIQUE INDEX app_user_email_uq ON app_user (lower(email)) WHERE email IS NOT NULL;

-- Permisos (Q1): independientes de la condición de brigadista.
CREATE TABLE user_role (
  user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  role        app_role NOT NULL,
  granted_by  uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  granted_at  timestamptz(3) NOT NULL DEFAULT now(),
  row_version bigint NOT NULL,
  PRIMARY KEY (user_id, role)
);
-- Revocar un rol = borrar la fila por la API administrativa + audit_log.
-- Es la única excepción a "sin DELETE": el rol de la app la tiene solo aquí.

CREATE TABLE device (
  id                    uuid PRIMARY KEY,                -- generado en el teléfono
  user_id               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  platform              device_platform NOT NULL,
  push_token            text,
  push_token_status     push_token_status,
  push_token_updated_at timestamptz(3),
  app_version           text,
  os_version            text,
  last_device_seq       bigint NOT NULL DEFAULT 0,       -- detecta huecos en la cola
  last_clock_offset_ms  integer,                         -- último desfase medido
  last_seen_at          timestamptz(3),
  revoked_at            timestamptz(3),
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT device_token_status_chk CHECK ((push_token IS NULL) = (push_token_status IS NULL))
);
CREATE UNIQUE INDEX device_push_token_uq ON device (push_token) WHERE push_token IS NOT NULL;
CREATE INDEX device_user_idx ON device (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_session (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  client_type        client_type NOT NULL,
  device_id          uuid REFERENCES device (id) ON DELETE RESTRICT,
  refresh_token_hash text NOT NULL UNIQUE,
  replaced_by_id     uuid REFERENCES auth_session (id) ON DELETE RESTRICT,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  expires_at         timestamptz(3) NOT NULL,
  last_used_at       timestamptz(3),
  revoked_at         timestamptz(3),
  CONSTRAINT auth_session_device_chk CHECK (client_type <> 'MOBILE' OR device_id IS NOT NULL)
);
CREATE INDEX auth_session_user_active_idx ON auth_session (user_id) WHERE revoked_at IS NULL;
```

## 4. Brigadista y disponibilidad

```sql
CREATE TABLE brigadista_profile (
  id                          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id                     uuid NOT NULL UNIQUE REFERENCES app_user (id) ON DELETE RESTRICT,
  active                      boolean NOT NULL DEFAULT true,  -- condición de brigadista (Q1)
  phone                       text,
  availability_status         availability_status NOT NULL DEFAULT 'NO_DISPONIBLE',
  availability_declared_at    timestamptz(3) NOT NULL,        -- base de la regla de 4 horas
  last_availability_change_id uuid,                           -- FK abajo (relación circular)
  joined_at                   timestamptz(3) NOT NULL DEFAULT now(),
  left_at                     timestamptz(3),
  created_at                  timestamptz(3) NOT NULL DEFAULT now(),
  updated_at                  timestamptz(3) NOT NULL DEFAULT now(),
  row_version                 bigint NOT NULL,
  CONSTRAINT brigadista_left_chk CHECK (active OR left_at IS NOT NULL)
);
CREATE INDEX brigadista_panel_idx ON brigadista_profile (availability_status, availability_declared_at)
  WHERE active;

CREATE TABLE availability_change (
  id                uuid PRIMARY KEY,                 -- UUID del teléfono = idempotencia
  brigadista_id     uuid NOT NULL REFERENCES brigadista_profile (id) ON DELETE RESTRICT,
  status            availability_status NOT NULL,
  source            action_source NOT NULL,
  declared_at       timestamptz(3) NOT NULL,          -- reloj de quien declaró, tal cual
  estimated_at      timestamptz(3) NOT NULL,          -- mejor estimación de la hora real
  time_confidence   time_confidence NOT NULL,
  received_at       timestamptz(3) NOT NULL DEFAULT now(),
  device_id         uuid REFERENCES device (id) ON DELETE RESTRICT,
  device_seq        bigint,
  base_row_version  bigint,                           -- versión del perfil que veía el teléfono
  created_offline   boolean NOT NULL DEFAULT false,
  sync_result       sync_result NOT NULL,             -- APPLIED, SUPERSEDED o CONFLICT
  row_version       bigint NOT NULL,
  CONSTRAINT availability_source_chk CHECK (source <> 'COORDINATOR_PROXY'),  -- D8
  CONSTRAINT availability_app_chk CHECK (source <> 'APP' OR (device_id IS NOT NULL AND device_seq IS NOT NULL)),
  CONSTRAINT availability_result_chk CHECK (sync_result <> 'REJECTED')
);
CREATE INDEX availability_history_idx ON availability_change (brigadista_id, estimated_at DESC);

ALTER TABLE brigadista_profile
  ADD CONSTRAINT brigadista_last_change_fk
  FOREIGN KEY (last_availability_change_id) REFERENCES availability_change (id) ON DELETE RESTRICT;
```

"Desactualizado" no se guarda: `now() - availability_declared_at > interval '4 hours'`.

## 5. Convocatorias

```sql
CREATE TABLE emergency (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  emergency_type text NOT NULL,                        -- texto libre (Q5)
  meeting_point  text NOT NULL,
  scheduled_at   timestamptz(3) NOT NULL,
  instructions   text,
  status         emergency_status NOT NULL DEFAULT 'DRAFT',
  created_by     uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  activated_by   uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  activated_at   timestamptz(3),
  closed_by      uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  closed_at      timestamptz(3),
  deleted_at     timestamptz(3),
  created_at     timestamptz(3) NOT NULL DEFAULT now(),
  updated_at     timestamptz(3) NOT NULL DEFAULT now(),
  row_version    bigint NOT NULL,
  CONSTRAINT emergency_activation_chk CHECK ((status = 'DRAFT') = (activated_at IS NULL)),
  CONSTRAINT emergency_activated_by_chk CHECK ((activated_at IS NULL) = (activated_by IS NULL)),
  CONSTRAINT emergency_closed_chk CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT emergency_closed_by_chk CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CONSTRAINT emergency_close_order_chk CHECK (closed_at IS NULL OR closed_at >= activated_at),
  CONSTRAINT emergency_delete_chk CHECK (deleted_at IS NULL OR status = 'DRAFT')
);
-- RN-05 / P1: a lo sumo una activa.
CREATE UNIQUE INDEX emergency_one_active_uq ON emergency (status) WHERE status = 'ACTIVE';
CREATE INDEX emergency_recent_idx ON emergency (created_at DESC) WHERE deleted_at IS NULL;

-- Al reabrir, closed_at y closed_by vuelven a NULL; el historial queda en
-- emergency_notice (REOPEN) y audit_log.

CREATE TABLE emergency_notice (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  emergency_id uuid NOT NULL REFERENCES emergency (id) ON DELETE RESTRICT,
  kind         notice_kind NOT NULL,
  message      text,
  created_by   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  row_version  bigint NOT NULL
);
CREATE INDEX emergency_notice_idx ON emergency_notice (emergency_id, created_at);

CREATE TABLE emergency_recipient (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  emergency_id        uuid NOT NULL REFERENCES emergency (id) ON DELETE RESTRICT,
  brigadista_id       uuid NOT NULL REFERENCES brigadista_profile (id) ON DELETE RESTRICT,
  added_reason        recipient_reason NOT NULL,
  added_by            uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  convoked_at         timestamptz(3) NOT NULL DEFAULT now(),
  current_response    response_value,                  -- NULL = pendiente
  current_response_id uuid,                            -- FK abajo (relación circular)
  responded_at        timestamptz(3),                  -- estimated_at de la respuesta vigente
  first_seen_at       timestamptz(3),                  -- primer acuse por cualquier vía
  updated_at          timestamptz(3) NOT NULL DEFAULT now(),
  row_version         bigint NOT NULL,
  CONSTRAINT recipient_once_uq UNIQUE (emergency_id, brigadista_id),
  CONSTRAINT recipient_response_chk CHECK (
    (current_response IS NULL) = (current_response_id IS NULL)
    AND (current_response IS NULL) = (responded_at IS NULL)),
  CONSTRAINT recipient_added_chk CHECK (added_reason <> 'LATE_ADDITION' OR added_by IS NOT NULL)
);
CREATE INDEX recipient_counts_idx ON emergency_recipient (emergency_id, current_response);
CREATE INDEX recipient_brigadista_idx ON emergency_recipient (brigadista_id, convoked_at DESC);

CREATE TABLE emergency_response (
  id                    uuid PRIMARY KEY,               -- UUID del teléfono o del backend
  recipient_id          uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  response              response_value NOT NULL,
  source                action_source NOT NULL,
  channel               contact_channel NOT NULL,
  recorded_by           uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  declared_at           timestamptz(3) NOT NULL,
  estimated_at          timestamptz(3) NOT NULL,
  time_confidence       time_confidence NOT NULL,
  received_at           timestamptz(3) NOT NULL DEFAULT now(),
  device_id             uuid REFERENCES device (id) ON DELETE RESTRICT,
  device_seq            bigint,
  base_row_version      bigint,
  created_offline       boolean NOT NULL DEFAULT false,
  late_sync_after_close boolean NOT NULL DEFAULT false, -- Q3: hecha antes del cierre, recibida después
  sync_result           sync_result NOT NULL,
  row_version           bigint NOT NULL,
  CONSTRAINT response_proxy_chk CHECK (
    source <> 'COORDINATOR_PROXY'
    OR (recorded_by IS NOT NULL AND channel <> 'APP' AND time_confidence = 'HUMAN_DECLARED')),
  CONSTRAINT response_app_chk CHECK (
    source <> 'APP' OR (channel = 'APP' AND device_id IS NOT NULL AND device_seq IS NOT NULL)),
  CONSTRAINT response_result_chk CHECK (sync_result <> 'REJECTED')
);
CREATE INDEX response_history_idx ON emergency_response (recipient_id, estimated_at DESC);

ALTER TABLE emergency_recipient
  ADD CONSTRAINT recipient_current_response_fk
  FOREIGN KEY (current_response_id) REFERENCES emergency_response (id) ON DELETE RESTRICT;
```

Las operaciones **rechazadas** no entran en las tablas de historial: quedan en
`sync_operation` con su payload (por eso los `CHECK ... <> 'REJECTED'`).

## 6. Entrega, acuses y contacto manual

```sql
CREATE TABLE notice_ack (
  id              uuid PRIMARY KEY,                     -- UUID del teléfono
  notice_id       uuid NOT NULL REFERENCES emergency_notice (id) ON DELETE RESTRICT,
  recipient_id    uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  device_id       uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  via             ack_via NOT NULL,
  acked_at_device timestamptz(3) NOT NULL,
  received_at     timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT notice_ack_once_uq UNIQUE (notice_id, recipient_id, device_id)
);

CREATE TABLE notification_delivery (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  notice_id            uuid NOT NULL REFERENCES emergency_notice (id) ON DELETE RESTRICT,
  recipient_id         uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  channel              delivery_channel NOT NULL,
  device_id            uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  status               delivery_status NOT NULL DEFAULT 'QUEUED',
  attempts             integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at      timestamptz(3),                  -- re-aviso a quien siga sin acuse
  queued_at            timestamptz(3) NOT NULL DEFAULT now(),
  sent_at              timestamptz(3),
  provider_accepted_at timestamptz(3),
  device_received_at   timestamptz(3),                  -- solo con notice_ack
  opened_at            timestamptz(3),
  failed_at            timestamptz(3),
  provider_message_id  text,
  last_error_code      text,
  updated_at           timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT delivery_once_uq UNIQUE (notice_id, recipient_id, channel, device_id),
  CONSTRAINT delivery_failed_chk CHECK ((status = 'FAILED') = (failed_at IS NOT NULL))
);
CREATE INDEX delivery_retry_idx ON notification_delivery (next_attempt_at)
  WHERE status IN ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED');

CREATE TABLE manual_contact (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  recipient_id uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  channel      contact_channel NOT NULL CHECK (channel <> 'APP'),
  outcome      contact_outcome NOT NULL,
  occurred_at  timestamptz(3) NOT NULL,                  -- hora real, declarada por el coordinador
  recorded_by  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  recorded_at  timestamptz(3) NOT NULL DEFAULT now(),
  note         text,
  CONSTRAINT manual_contact_time_chk CHECK (occurred_at <= recorded_at + interval '5 minutes')
);
CREATE INDEX manual_contact_idx ON manual_contact (recipient_id, occurred_at DESC);

-- Condicional P2: control de presencia en terreno.
CREATE TABLE emergency_attendance (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  recipient_id uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  event        attendance_event NOT NULL,
  occurred_at  timestamptz(3) NOT NULL,
  recorded_by  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  recorded_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX attendance_idx ON emergency_attendance (recipient_id, occurred_at DESC);
```

## 7. Sincronización y auditoría

```sql
CREATE TABLE sync_operation (
  operation_id      uuid PRIMARY KEY,                   -- idempotencia: reenviar devuelve el resultado guardado
  device_id         uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  user_id           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  device_seq        bigint NOT NULL CHECK (device_seq > 0),
  operation_type    text NOT NULL CHECK (operation_type IN
                      ('DECLARE_AVAILABILITY', 'RESPOND_EMERGENCY', 'ACK_NOTICE', 'REGISTER_PUSH_TOKEN')),
  payload           jsonb NOT NULL,                     -- sin secretos
  base_row_version  bigint,
  entity_id         uuid,
  result            sync_result NOT NULL,
  result_code       text,                               -- motivo de rechazo o conflicto
  received_at       timestamptz(3) NOT NULL DEFAULT now(),
  resolution_status resolution_status NOT NULL DEFAULT 'NONE',
  resolved_by       uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  resolved_at       timestamptz(3),
  resolution_note   text,
  CONSTRAINT sync_operation_seq_uq UNIQUE (device_id, device_seq),
  CONSTRAINT sync_operation_review_chk CHECK (
    result IN ('APPLIED', 'SUPERSEDED') OR resolution_status <> 'NONE'),
  CONSTRAINT sync_operation_resolved_chk CHECK (
    (resolution_status = 'RESOLVED') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX sync_operation_review_idx ON sync_operation (received_at)
  WHERE resolution_status = 'PENDING_REVIEW';
-- Solo se actualizan las columnas de resolución (permiso por columna al rol de la app).

CREATE TABLE sync_metadata (
  id               smallint PRIMARY KEY CHECK (id = 1),
  sync_epoch       uuid NOT NULL,
  epoch_started_at timestamptz(3) NOT NULL DEFAULT now()
);
-- Procedimiento de restauración (devops): tras restaurar, ejecutar
-- UPDATE sync_metadata SET sync_epoch = uuidv7(), epoch_started_at = now();

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  action        text NOT NULL,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb NOT NULL DEFAULT '{}',            -- sin secretos ni RUT completo
  created_at    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
```

## 8. Índices de sincronización

Para cada tabla replicada, un índice por `row_version` filtrado por el ámbito de
lectura del teléfono:

```sql
CREATE INDEX emergency_sync_idx            ON emergency (row_version) WHERE status <> 'DRAFT';
CREATE INDEX emergency_notice_sync_idx     ON emergency_notice (row_version);
CREATE INDEX recipient_sync_idx            ON emergency_recipient (brigadista_id, row_version);
CREATE INDEX response_sync_idx             ON emergency_response (recipient_id, row_version);
CREATE INDEX availability_sync_idx         ON availability_change (brigadista_id, row_version);
CREATE INDEX brigadista_profile_sync_idx   ON brigadista_profile (row_version);
CREATE INDEX app_user_sync_idx             ON app_user (row_version);
CREATE INDEX user_role_sync_idx            ON user_role (user_id, row_version);
```

## 9. Transacciones críticas

| Operación                   | En una sola transacción                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activar convocatoria        | `emergency` → `ACTIVE` (falla si ya hay otra activa); `emergency_recipient` por cada usuario con `app_user.active` **y** `brigadista_profile.active`; `emergency_notice` `ACTIVATION`; `notification_delivery` `QUEUED` por convocado y dispositivo no revocado con token válido; `audit_log` |
| Respuesta desde la app      | `sync_operation`; `emergency_response`; actualizar `emergency_recipient` si resulta `APPLIED`                                                                                                                                                                                                 |
| Declarar disponibilidad     | `sync_operation`; `availability_change`; actualizar `brigadista_profile` si resulta `APPLIED`                                                                                                                                                                                                 |
| Acuse                       | `sync_operation`; `notice_ack` (si ya existe, operación repetida); `first_seen_at` y `device_received_at` si están vacíos                                                                                                                                                                     |
| Restablecer contraseña (Q6) | Nuevo hash; `must_change_password = true`; `password_expires_at`; revocar `auth_session`; `audit_log`                                                                                                                                                                                         |
| Desactivar cuenta o perfil  | Marcar inactivo; revocar sesiones; conservar convocados e historial; `audit_log`                                                                                                                                                                                                              |

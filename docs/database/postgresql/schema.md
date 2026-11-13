# PostgreSQL — DDL de referencia (revisión 2.1)

> **DDL de referencia del diseño. No es una migración** y no debe ejecutarse.
> Lo ejecutable es `backend/prisma/schema.prisma` + `backend/prisma/migrations/`
> (backend-architect), aplicado hasta ahora **solo en la base local de Docker**
> (PostgreSQL 18.7). PostgreSQL 18. Fechas en UTC (`timestamptz(3)`).
>
> La revisión 2.1 no cambia decisiones aprobadas: incorpora los ajustes de la
> auditoría de la implementación (H2–H7) y dos decisiones de implementación de
> backend-architect (índices parciales solo en SQL manual; `updated_at` solo por
> trigger). Detalle y verificación: [`../review-checklist.md`](../review-checklist.md)
> §5. Cambios respecto de la revisión 1: mismo documento, §1.

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
-- Solo hechos del proveedor. Los hechos del dispositivo viven en notice_ack.
CREATE TYPE delivery_status     AS ENUM ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED', 'PROVIDER_DELIVERED', 'FAILED');
CREATE TYPE ack_level           AS ENUM ('RECEIVED', 'OPENED');
CREATE TYPE ack_via             AS ENUM ('PUSH', 'SYNC');
CREATE TYPE device_platform     AS ENUM ('ANDROID', 'IOS');
CREATE TYPE push_token_status   AS ENUM ('VALID', 'INVALID');
CREATE TYPE client_type         AS ENUM ('MOBILE', 'WEB');
CREATE TYPE session_scope       AS ENUM ('FULL', 'PASSWORD_CHANGE_ONLY');
CREATE TYPE time_confidence     AS ENUM ('MONOTONIC', 'CLOCK_OFFSET', 'SERVER_RECEIPT', 'HUMAN_DECLARED');
CREATE TYPE sync_result         AS ENUM ('APPLIED', 'SUPERSEDED', 'CONFLICT', 'REJECTED');
CREATE TYPE resolution_action   AS ENUM ('NOTE', 'CONFIRMED', 'CORRECTED', 'DISMISSED');
```

## 2. Mecanismos comunes

```sql
-- CACHE 1 es obligatorio: con caché por sesión, dos sesiones reciben números
-- fuera de orden y la garantía de versioning.md deja de valer.
CREATE SEQUENCE sync_row_version_seq AS bigint CACHE 1;

CREATE FUNCTION set_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Candado de transacción con clave fija. Se libera recién al terminar la
  -- transacción, después de que su commit es visible. Ver versioning.md.
  PERFORM pg_advisory_xact_lock(7352001);
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

| Trigger                                     | Tablas                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_row_version` `BEFORE INSERT OR UPDATE` | `app_user`, `brigadista_profile`, `availability_change`, `emergency`, `emergency_notice`, `emergency_recipient`, `emergency_response`                       |
| `touch_updated_at` `BEFORE UPDATE`          | Tablas con `updated_at`: `app_user`, `device`, `brigadista_profile`, `emergency`, `emergency_recipient`, `notification_delivery`                            |
| `forbid_mutation` `BEFORE UPDATE OR DELETE` | `availability_change`, `emergency_notice`, `emergency_response`, `notice_ack`, `manual_contact`, `sync_operation`, `sync_operation_resolution`, `audit_log` |

Reglas de la revisión 2.1:

- **`row_version`**: en Prisma tiene `@default(0)` solo para que no se exija al
  insertar; el trigger siempre lo sobrescribe con `nextval` (≥ 1). Cada tabla
  replicada lleva `CHECK (row_version > 0)` (H7): si una tabla quedara sin
  trigger, la escritura falla en vez de guardar filas con versión 0, invisibles
  para la descarga.
- **`updated_at`**: `DEFAULT now()` al insertar y `touch_updated_at` al
  actualizar. Es la **única** fuente: sin `@updatedAt` de Prisma, para que la
  hora sea siempre la del servidor de base de datos y no la del reloj de la
  aplicación.
- **Índices parciales** (los 9 con `WHERE` de este documento): viven **solo en
  el SQL de las migraciones**. Prisma no los declara (sin el preview
  `partialIndexes`) y los ignora al comparar, así que no generan deriva. Uno
  nuevo se agrega a mano en una migración nueva.
- **`app_user` y el candado (H9)**: hay una propuesta para que `set_row_version`
  en `app_user` solo actúe cuando cambian columnas replicadas
  (`../review-checklist.md` §5.4). Hasta que se apruebe e implemente, rige el
  trigger de la tabla de arriba.

Permisos del rol de la aplicación: sin `DELETE` en ninguna tabla salvo
`user_role`; sin `UPDATE` en las tablas append-only. Es una segunda barrera
además de los triggers.

## 3. Identidad, permisos y sesiones

```sql
CREATE TABLE app_user (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  rut                  text NOT NULL UNIQUE,            -- canónico 12345678-5
  password_hash        text NOT NULL,                   -- Argon2id
  full_name            text NOT NULL,
  email                text,                            -- siempre en minúsculas (H2)
  active               boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  password_expires_at  timestamptz(3),                  -- vencimiento de la contraseña provisoria
  credential_version   integer NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  password_changed_at  timestamptz(3),
  last_login_at        timestamptz(3),
  deactivated_at       timestamptz(3),
  deactivated_by       uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  created_at           timestamptz(3) NOT NULL DEFAULT now(),
  updated_at           timestamptz(3) NOT NULL DEFAULT now(),
  row_version          bigint NOT NULL CHECK (row_version > 0),
  -- Solo formato. El dígito verificador lo valida packages/shared/ en el backend
  -- (decisión de la revisión 2.1, ver review-checklist.md §5.5).
  CONSTRAINT app_user_rut_format_chk CHECK (rut ~ '^[1-9][0-9]{0,7}-[0-9K]$'),
  CONSTRAINT app_user_email_lower_chk CHECK (email IS NULL OR email = lower(email)),
  CONSTRAINT app_user_deactivation_chk CHECK (active = (deactivated_at IS NULL)),
  CONSTRAINT app_user_provisional_chk CHECK (must_change_password = (password_expires_at IS NOT NULL))
);
-- H2: único simple + CHECK de minúsculas en vez de índice sobre lower(email).
-- Equivalente: con todo correo en minúsculas, único sobre email = único sobre
-- lower(email), y varios NULL no chocan (NULLS DISTINCT). El backend aplica
-- lower() al escribir y al buscar.
CREATE UNIQUE INDEX app_user_email_key ON app_user (email);
CREATE INDEX app_user_sync_idx ON app_user (row_version);

-- Permisos (Q1), independientes de la condición de brigadista.
CREATE TABLE user_role (
  user_id    uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  role       app_role NOT NULL,
  granted_by uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  granted_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);
-- Otorgar o revocar un rol, en la misma transacción: touch de app_user
-- (nuevo row_version) + audit_log. Así el teléfono recibe la lista completa de
-- roles con su usuario y el borrado no necesita lápida.

CREATE TABLE device (
  id                    uuid PRIMARY KEY,               -- generado en el teléfono
  user_id               uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  platform              device_platform NOT NULL,
  push_token            text,
  push_token_status     push_token_status,
  push_token_updated_at timestamptz(3),
  app_version           text,
  os_version            text,
  last_device_seq       bigint NOT NULL DEFAULT 0,      -- CHECK device_last_seq_chk (H6)
  last_clock_offset_ms  integer,
  last_seen_at          timestamptz(3),
  revoked_at            timestamptz(3),
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT device_token_status_chk CHECK ((push_token IS NULL) = (push_token_status IS NULL)),
  CONSTRAINT device_last_seq_chk CHECK (last_device_seq >= 0)
);
-- H3: sin predicado. Equivale al parcial WHERE push_token IS NOT NULL porque
-- los NULL no chocan entre sí (NULLS DISTINCT, comportamiento por defecto).
CREATE UNIQUE INDEX device_push_token_uq ON device (push_token);
CREATE INDEX device_user_idx ON device (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_session (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  family_id          uuid NOT NULL,                   -- cadena de rotación; reutilizar un token revoca la familia
  client_type        client_type NOT NULL,
  device_id          uuid REFERENCES device (id) ON DELETE RESTRICT,
  scope              session_scope NOT NULL,
  credential_version integer NOT NULL,                -- copia de app_user al emitir
  refresh_token_hash text NOT NULL UNIQUE,
  replaced_by_id     uuid REFERENCES auth_session (id) ON DELETE RESTRICT,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  expires_at         timestamptz(3) NOT NULL,
  last_used_at       timestamptz(3),
  revoked_at         timestamptz(3),
  revoked_reason     text,
  CONSTRAINT auth_session_device_chk CHECK (client_type <> 'MOBILE' OR device_id IS NOT NULL),
  CONSTRAINT auth_session_expiry_chk CHECK (expires_at > created_at),
  CONSTRAINT auth_session_revoked_chk CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  -- H6: los 8 motivos de security.md.
  CONSTRAINT auth_session_reason_chk CHECK (revoked_reason IS NULL OR revoked_reason IN
    ('LOGOUT', 'ROTATED', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'ACCOUNT_DEACTIVATED',
     'DEVICE_REVOKED', 'REUSE_DETECTED', 'EXPIRED'))
);
CREATE INDEX auth_session_user_active_idx ON auth_session (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_session_family_idx ON auth_session (family_id);
```

Reglas de sesión verificadas en [`../security.md`](../security.md).

## 4. Brigadista y disponibilidad

```sql
CREATE TABLE brigadista_profile (
  id                          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id                     uuid NOT NULL UNIQUE REFERENCES app_user (id) ON DELETE RESTRICT,
  active                      boolean NOT NULL DEFAULT true,  -- condición de brigadista (Q1)
  phone                       text,
  availability_status         availability_status NOT NULL DEFAULT 'NO_DISPONIBLE',
  availability_declared_at    timestamptz(3) NOT NULL,
  last_availability_change_id uuid UNIQUE,                    -- FK abajo; único (H4)
  joined_at                   timestamptz(3) NOT NULL DEFAULT now(),
  left_at                     timestamptz(3),
  created_at                  timestamptz(3) NOT NULL DEFAULT now(),
  updated_at                  timestamptz(3) NOT NULL DEFAULT now(),
  row_version                 bigint NOT NULL CHECK (row_version > 0),
  CONSTRAINT brigadista_left_chk CHECK (active = (left_at IS NULL))
);
CREATE INDEX brigadista_panel_idx ON brigadista_profile (availability_status, availability_declared_at) WHERE active;
CREATE INDEX brigadista_profile_sync_idx ON brigadista_profile (row_version);

CREATE TABLE availability_change (
  id               uuid PRIMARY KEY,                  -- UUID del teléfono = idempotencia
  brigadista_id    uuid NOT NULL REFERENCES brigadista_profile (id) ON DELETE RESTRICT,
  status           availability_status NOT NULL,
  source           action_source NOT NULL,
  declared_at      timestamptz(3) NOT NULL,
  estimated_at     timestamptz(3) NOT NULL,
  time_confidence  time_confidence NOT NULL,
  received_at      timestamptz(3) NOT NULL DEFAULT now(),
  device_id        uuid REFERENCES device (id) ON DELETE RESTRICT,
  device_seq       bigint,
  base_row_version bigint,
  created_offline  boolean NOT NULL DEFAULT false,
  sync_result      sync_result NOT NULL,              -- fijado al insertar; nunca cambia
  row_version      bigint NOT NULL CHECK (row_version > 0),
  CONSTRAINT availability_source_chk CHECK (source <> 'COORDINATOR_PROXY'),
  CONSTRAINT availability_app_chk CHECK (source <> 'APP' OR (device_id IS NOT NULL AND device_seq IS NOT NULL)),
  CONSTRAINT availability_result_chk CHECK (sync_result <> 'REJECTED'),
  CONSTRAINT availability_time_chk CHECK (estimated_at <= received_at)
);
CREATE INDEX availability_history_idx ON availability_change (brigadista_id, estimated_at DESC);
CREATE INDEX availability_sync_idx ON availability_change (brigadista_id, row_version);

ALTER TABLE brigadista_profile
  ADD CONSTRAINT brigadista_last_change_fk
  FOREIGN KEY (last_availability_change_id) REFERENCES availability_change (id) ON DELETE RESTRICT;
```

## 5. Convocatorias, bandeja y respuestas

```sql
CREATE TABLE emergency (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  emergency_type text NOT NULL,
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
  row_version    bigint NOT NULL CHECK (row_version > 0),
  CONSTRAINT emergency_activation_chk CHECK ((status = 'DRAFT') = (activated_at IS NULL)),
  CONSTRAINT emergency_activated_by_chk CHECK ((activated_at IS NULL) = (activated_by IS NULL)),
  CONSTRAINT emergency_closed_chk CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT emergency_closed_by_chk CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CONSTRAINT emergency_close_order_chk CHECK (closed_at IS NULL OR closed_at >= activated_at),
  CONSTRAINT emergency_delete_chk CHECK (deleted_at IS NULL OR status = 'DRAFT')
);
-- P1 aprobado: a lo sumo una activa.
CREATE UNIQUE INDEX emergency_one_active_uq ON emergency (status) WHERE status = 'ACTIVE';
CREATE INDEX emergency_recent_idx ON emergency (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX emergency_sync_idx ON emergency (row_version) WHERE status <> 'DRAFT';

CREATE TABLE emergency_notice (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  emergency_id uuid NOT NULL REFERENCES emergency (id) ON DELETE RESTRICT,
  kind         notice_kind NOT NULL,
  message      text,
  created_by   uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  row_version  bigint NOT NULL CHECK (row_version > 0)
);
CREATE INDEX emergency_notice_idx ON emergency_notice (emergency_id, created_at);
CREATE INDEX emergency_notice_sync_idx ON emergency_notice (row_version);

-- Bandeja interna: existe aunque el brigadista no tenga dispositivo ni push.
CREATE TABLE emergency_recipient (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  emergency_id        uuid NOT NULL REFERENCES emergency (id) ON DELETE RESTRICT,
  brigadista_id       uuid NOT NULL REFERENCES brigadista_profile (id) ON DELETE RESTRICT,
  added_reason        recipient_reason NOT NULL,
  added_by            uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  convoked_at         timestamptz(3) NOT NULL DEFAULT now(),
  current_response    response_value,                 -- NULL = pendiente
  current_response_id uuid UNIQUE,                    -- FK abajo; único (H4)
  responded_at        timestamptz(3),
  updated_at          timestamptz(3) NOT NULL DEFAULT now(),
  row_version         bigint NOT NULL CHECK (row_version > 0),
  CONSTRAINT recipient_once_uq UNIQUE (emergency_id, brigadista_id),
  CONSTRAINT recipient_response_chk CHECK (
    (current_response IS NULL) = (current_response_id IS NULL)
    AND (current_response IS NULL) = (responded_at IS NULL)),
  CONSTRAINT recipient_added_chk CHECK ((added_reason = 'LATE_ADDITION') = (added_by IS NOT NULL))
);
CREATE INDEX recipient_counts_idx ON emergency_recipient (emergency_id, current_response);
CREATE INDEX recipient_sync_idx ON emergency_recipient (brigadista_id, row_version);

CREATE TABLE emergency_response (
  id                    uuid PRIMARY KEY,
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
  late_sync_after_close boolean NOT NULL DEFAULT false,
  sync_result           sync_result NOT NULL,
  corrects_operation_id uuid,                          -- si corrige un conflicto o rechazo (FK abajo)
  row_version           bigint NOT NULL CHECK (row_version > 0),
  CONSTRAINT response_proxy_chk CHECK (
    source <> 'COORDINATOR_PROXY'
    OR (recorded_by IS NOT NULL AND channel <> 'APP' AND time_confidence = 'HUMAN_DECLARED')),
  CONSTRAINT response_app_chk CHECK (
    source <> 'APP' OR (channel = 'APP' AND device_id IS NOT NULL AND device_seq IS NOT NULL)),
  CONSTRAINT response_result_chk CHECK (sync_result <> 'REJECTED'),
  CONSTRAINT response_time_chk CHECK (estimated_at <= received_at)
);
CREATE INDEX response_history_idx ON emergency_response (recipient_id, estimated_at DESC);
CREATE INDEX response_sync_idx ON emergency_response (recipient_id, row_version);

ALTER TABLE emergency_recipient
  ADD CONSTRAINT recipient_current_response_fk
  FOREIGN KEY (current_response_id) REFERENCES emergency_response (id) ON DELETE RESTRICT;
```

## 6. Entrega push, acuse del dispositivo y contacto manual

Tres hechos distintos, en tablas distintas. Ver
[`../synchronization/delivery-and-ack.md`](../synchronization/delivery-and-ack.md).

```sql
-- Hechos del proveedor push (Expo/FCM/APNs). Nunca registra hechos del dispositivo.
CREATE TABLE notification_delivery (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  notice_id             uuid NOT NULL REFERENCES emergency_notice (id) ON DELETE RESTRICT,
  recipient_id          uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  channel               delivery_channel NOT NULL,
  device_id             uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  status                delivery_status NOT NULL DEFAULT 'QUEUED',
  attempts              integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at       timestamptz(3),
  queued_at             timestamptz(3) NOT NULL DEFAULT now(),
  sent_at               timestamptz(3),
  provider_accepted_at  timestamptz(3),               -- ticket del proveedor
  provider_delivered_at timestamptz(3),               -- recibo: entregado a FCM/APNs, no al teléfono
  failed_at             timestamptz(3),
  provider_message_id   text,
  last_error_code       text,
  updated_at            timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT delivery_once_uq UNIQUE (notice_id, recipient_id, channel, device_id),
  CONSTRAINT delivery_failed_chk CHECK ((status = 'FAILED') = (failed_at IS NOT NULL)),
  CONSTRAINT delivery_sent_chk CHECK (status IN ('QUEUED', 'FAILED') OR sent_at IS NOT NULL),
  CONSTRAINT delivery_accepted_chk CHECK (status NOT IN ('PROVIDER_ACCEPTED', 'PROVIDER_DELIVERED')
                                          OR provider_accepted_at IS NOT NULL),
  CONSTRAINT delivery_delivered_chk CHECK ((status = 'PROVIDER_DELIVERED') = (provider_delivered_at IS NOT NULL))
);
CREATE INDEX delivery_retry_idx ON notification_delivery (next_attempt_at)
  WHERE status IN ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED');

-- Hechos del dispositivo. Solo los escribe el teléfono (vía sync); nunca el servidor por su cuenta.
CREATE TABLE notice_ack (
  id              uuid PRIMARY KEY,                    -- UUID del teléfono
  notice_id       uuid NOT NULL REFERENCES emergency_notice (id) ON DELETE RESTRICT,
  recipient_id    uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  device_id       uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  level           ack_level NOT NULL,                  -- RECEIVED: la app tiene el aviso; OPENED: el usuario lo abrió
  via             ack_via,                             -- cómo llegó (solo RECEIVED)
  acked_at_device timestamptz(3) NOT NULL,
  received_at     timestamptz(3) NOT NULL DEFAULT now(),
  operation_id    uuid NOT NULL UNIQUE,                -- FK abajo; una operación origina a lo sumo un acuse (H4)
  CONSTRAINT notice_ack_once_uq UNIQUE (notice_id, recipient_id, device_id, level),
  CONSTRAINT notice_ack_via_chk CHECK ((level = 'RECEIVED') = (via IS NOT NULL))
);
CREATE INDEX notice_ack_recipient_idx ON notice_ack (recipient_id, notice_id, level);

CREATE TABLE manual_contact (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  recipient_id uuid NOT NULL REFERENCES emergency_recipient (id) ON DELETE RESTRICT,
  channel      contact_channel NOT NULL CHECK (channel <> 'APP'),
  outcome      contact_outcome NOT NULL,
  occurred_at  timestamptz(3) NOT NULL,
  recorded_by  uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  recorded_at  timestamptz(3) NOT NULL DEFAULT now(),
  note         text,
  CONSTRAINT manual_contact_time_chk CHECK (occurred_at <= recorded_at + interval '5 minutes')
);
CREATE INDEX manual_contact_idx ON manual_contact (recipient_id, occurred_at DESC);
```

`emergency_attendance` fue **retirada** (P2: fuera del MVP).

## 7. Sincronización, resoluciones y auditoría

```sql
-- Operación original tal como llegó. Inmutable (append-only).
CREATE TABLE sync_operation (
  operation_id     uuid PRIMARY KEY,
  device_id        uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  user_id          uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  device_seq       bigint NOT NULL CHECK (device_seq > 0),
  operation_type   text NOT NULL CHECK (operation_type IN
                     ('DECLARE_AVAILABILITY', 'RESPOND_EMERGENCY', 'ACK_NOTICE', 'REGISTER_PUSH_TOKEN')),
  payload          jsonb NOT NULL,                     -- sin secretos
  base_row_version bigint,
  entity_id        uuid,
  result           sync_result NOT NULL,
  result_code      text,
  received_at      timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT sync_operation_seq_uq UNIQUE (device_id, device_seq),
  CONSTRAINT sync_operation_code_chk CHECK (result IN ('APPLIED', 'SUPERSEDED') OR result_code IS NOT NULL)
);
CREATE INDEX sync_operation_review_idx ON sync_operation (received_at) WHERE result IN ('CONFLICT', 'REJECTED');

-- Resoluciones como eventos separados (append-only). La operación original no se toca.
CREATE TABLE sync_operation_resolution (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  operation_id          uuid NOT NULL REFERENCES sync_operation (operation_id) ON DELETE RESTRICT,
  action                resolution_action NOT NULL,
  resolved_by           uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  resolved_at           timestamptz(3) NOT NULL DEFAULT now(),
  note                  text,
  corrective_response_id uuid REFERENCES emergency_response (id) ON DELETE RESTRICT,
  CONSTRAINT resolution_correction_chk CHECK ((action = 'CORRECTED') = (corrective_response_id IS NOT NULL)),
  CONSTRAINT resolution_note_chk CHECK (action <> 'NOTE' OR note IS NOT NULL)
);
-- H5: todas las resoluciones de una operación, incluidas las notas.
CREATE INDEX resolution_operation_idx ON sync_operation_resolution (operation_id);
-- A lo sumo una resolución final por operación; las notas son ilimitadas.
CREATE UNIQUE INDEX resolution_final_uq ON sync_operation_resolution (operation_id) WHERE action <> 'NOTE';

ALTER TABLE notice_ack
  ADD CONSTRAINT notice_ack_operation_fk
  FOREIGN KEY (operation_id) REFERENCES sync_operation (operation_id) ON DELETE RESTRICT;
ALTER TABLE emergency_response
  ADD CONSTRAINT response_corrects_fk
  FOREIGN KEY (corrects_operation_id) REFERENCES sync_operation (operation_id) ON DELETE RESTRICT;

-- Pendientes de revisión = CONFLICT o REJECTED sin resolución final:
--   SELECT o.* FROM sync_operation o
--   WHERE o.result IN ('CONFLICT', 'REJECTED')
--     AND NOT EXISTS (SELECT 1 FROM sync_operation_resolution r
--                     WHERE r.operation_id = o.operation_id AND r.action <> 'NOTE');

CREATE TABLE sync_metadata (
  id               smallint PRIMARY KEY CHECK (id = 1),
  sync_epoch       uuid NOT NULL,
  epoch_started_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id uuid REFERENCES app_user (id) ON DELETE RESTRICT,
  action        text NOT NULL,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb NOT NULL DEFAULT '{}',           -- sin secretos ni RUT completo
  created_at    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_time_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
```

## 8. Transacciones críticas

Toda transacción que escriba en una tabla replicada toma primero
`pg_advisory_xact_lock(7352001)` (orden fijo de candados; ver `versioning.md`).

| Operación                   | En una sola transacción                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activar convocatoria        | Candado; `emergency` → `ACTIVE`; `emergency_recipient` por cada usuario con `app_user.active` y `brigadista_profile.active`; `emergency_notice` `ACTIVATION`; `notification_delivery` `QUEUED` por dispositivo no revocado con token `VALID`; `audit_log`. El envío al proveedor ocurre **después** del commit |
| Respuesta desde la app      | Candado; `sync_operation`; `emergency_response` si no es `REJECTED`; `emergency_recipient` si es `APPLIED`                                                                                                                                                                                                     |
| Declarar disponibilidad     | Candado; `sync_operation`; `availability_change` si no es `REJECTED`; `brigadista_profile` si es `APPLIED`                                                                                                                                                                                                     |
| Acuse                       | `sync_operation`; `notice_ack` (si existe el mismo nivel, la operación es repetida)                                                                                                                                                                                                                            |
| Resolver una operación      | `sync_operation_resolution`; si `CORRECTED`, candado + `emergency_response` `COORDINATOR_PROXY` con `corrects_operation_id`; `audit_log`                                                                                                                                                                       |
| Restablecer contraseña (Q6) | Ver `security.md` §2                                                                                                                                                                                                                                                                                           |
| Desactivar cuenta o perfil  | `SELECT ... FOR UPDATE` de `app_user`; inactivo; `credential_version + 1`; revocar sesiones; `audit_log`. Convocados e historial se conservan                                                                                                                                                                  |
| Restaurar backup (devops)   | `UPDATE sync_metadata SET sync_epoch = uuidv7(), epoch_started_at = now()`                                                                                                                                                                                                                                     |

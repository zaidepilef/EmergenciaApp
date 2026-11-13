# Modelo lógico preliminar

> **Ampliado por [`failure-scenarios.md`](failure-scenarios.md)**: avisos
> (`emergency_notice`), convocados tardíos, respuestas registradas por el
> coordinador, contactos manuales, presencia en terreno (pendiente) y época de
> sincronización. Donde difieran, prevalece ese documento.

> **Estado: PROPUESTA PRELIMINAR — pendiente de aprobación.**
> No son tablas definitivas: no hay DDL, migraciones ni `schema.prisma`. Los
> nombres y tipos pueden cambiar en el modelo físico.

## 1. Convenciones

- Nombres de tablas y columnas en inglés, `snake_case`, tablas en singular.
- Clave primaria `id` de tipo **UUID v7** en todas las entidades. Las entidades
  creadas en el teléfono reciben el UUID del dispositivo; las del servidor, uno
  generado por el backend.
- Fechas siempre en **UTC** con milisegundos. La presentación usa la zona de la
  brigada (supuesto: `America/Santiago`).
- Dominios cerrados (roles, estados) como enumeraciones.
- Tablas replicadas al teléfono llevan `row_version`, `updated_at` y, si se pueden
  retirar, `deleted_at` (borrado lógico que viaja como "lápida").
- Historial y auditoría son **append-only**: no se actualizan ni se borran.
- `user` es palabra reservada en PostgreSQL: se usa `app_user`.

## 2. Tipos portables

| Tipo lógico | PostgreSQL       | Prisma                        | SQLite (móvil)                                                                      |
| ----------- | ---------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `uuid`      | `uuid`           | `String @db.Uuid`             | `TEXT` (36 caracteres, minúsculas)                                                  |
| `timestamp` | `timestamptz(3)` | `DateTime @db.Timestamptz(3)` | `TEXT` ISO-8601 fijo `YYYY-MM-DDTHH:MM:SS.sssZ` (orden lexicográfico = cronológico) |
| `enum`      | tipo `enum`      | `enum`                        | `TEXT` + `CHECK (col IN (...))`                                                     |
| `bool`      | `boolean`        | `Boolean`                     | `INTEGER` + `CHECK (col IN (0,1))`                                                  |
| `text`      | `text`           | `String`                      | `TEXT`                                                                              |
| `bigint`    | `bigint`         | `BigInt`                      | `INTEGER`                                                                           |
| `json`      | `jsonb`          | `Json`                        | `TEXT` (solo en la cola local)                                                      |

## 3. Enumeraciones

| Enum                  | Valores                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `user_role`           | `ADMINISTRADOR`, `COORDINADOR`, `BRIGADISTA`                                 |
| `availability_status` | `DISPONIBLE`, `NO_DISPONIBLE`, `EN_SERVICIO`                                 |
| `emergency_status`    | `DRAFT`, `ACTIVE`, `CLOSED`                                                  |
| `response_value`      | `VOY`, `NO_PUEDO`                                                            |
| `delivery_channel`    | `PUSH` (extensible: `SMS`, `LORA`, `RADIO` en el futuro)                     |
| `delivery_status`     | `QUEUED`, `SENT`, `PROVIDER_ACCEPTED`, `DEVICE_RECEIVED`, `OPENED`, `FAILED` |
| `device_platform`     | `ANDROID`, `IOS`                                                             |
| `client_type`         | `MOBILE`, `WEB`                                                              |
| `operation_result`    | `APPLIED`, `REJECTED`, `CONFLICT`                                            |

## 4. Entidades del servidor (PostgreSQL)

Leyenda: **PK** clave primaria · **FK** clave foránea · **U** única · **NN** obligatorio.

### `app_user` — cuenta de acceso

| Columna                            | Tipo      | Reglas                                                     |
| ---------------------------------- | --------- | ---------------------------------------------------------- |
| id                                 | uuid      | PK                                                         |
| rut                                | text      | U, NN. Forma canónica `12345678-5`, validada con módulo 11 |
| password_hash                      | text      | NN. Argon2id. Nunca se expone ni se replica                |
| role                               | user_role | NN                                                         |
| active                             | bool      | NN, por defecto verdadero                                  |
| full_name                          | text      | NN                                                         |
| email                              | text      | U cuando no es nulo                                        |
| must_change_password               | bool      | NN                                                         |
| password_changed_at, last_login_at | timestamp | Opcionales                                                 |
| created_at, updated_at             | timestamp | NN                                                         |

### `brigadista_profile` — datos operativos (replicado: solo el propio)

| Columna                             | Tipo                | Reglas                                                             |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------ |
| id                                  | uuid                | PK                                                                 |
| user_id                             | uuid                | FK `app_user`, U, NN                                               |
| phone                               | text                | Opcional                                                           |
| availability_status                 | availability_status | NN. Estado **actual**                                              |
| availability_declared_at            | timestamp           | NN. Momento de la última declaración (base de la regla de 4 horas) |
| last_availability_change_id         | uuid                | FK `availability_change`. Evento que fijó el estado actual         |
| created_at, updated_at, row_version |                     | NN                                                                 |

"Desactualizado" no se guarda: se calcula como `ahora − availability_declared_at > 4 h`.

### `availability_change` — historial de disponibilidad (append-only, se crea en el teléfono)

| Columna        | Tipo                | Reglas                                                                   |
| -------------- | ------------------- | ------------------------------------------------------------------------ |
| id             | uuid                | PK. Generado en el dispositivo; sirve también como clave de idempotencia |
| brigadista_id  | uuid                | FK `brigadista_profile`, NN                                              |
| status         | availability_status | NN. Puede repetir el estado anterior (reconfirmación, Q2)                |
| declared_at    | timestamp           | NN. Reloj del dispositivo al declarar                                    |
| received_at    | timestamp           | NN. Reloj del servidor al recibir                                        |
| device_id      | uuid                | FK `device`. Nulo si se declaró desde la web                             |
| clock_adjusted | bool                | NN. Verdadero si `declared_at` venía en el futuro y se ajustó            |
| row_version    | bigint              | NN                                                                       |

Regla: el estado actual del perfil es el del cambio con mayor `declared_at`
(desempate por `id`). Un cambio más antiguo que el actual queda en el historial
pero **no** sobrescribe el estado.

### `emergency` — convocatoria (replicada: activas y recientes)

| Columna                                         | Tipo             | Reglas                                                      |
| ----------------------------------------------- | ---------------- | ----------------------------------------------------------- |
| id                                              | uuid             | PK                                                          |
| emergency_type                                  | text             | NN. Texto libre en el MVP (Q5)                              |
| meeting_point                                   | text             | NN. Lugar o punto de encuentro como texto (sin coordenadas) |
| scheduled_at                                    | timestamp        | NN. Fecha y hora de la convocatoria                         |
| instructions                                    | text             | Opcional                                                    |
| status                                          | emergency_status | NN                                                          |
| created_by                                      | uuid             | FK `app_user` (coordinador), NN                             |
| activated_by, activated_at                      | uuid, timestamp  | NN cuando `status` ≠ `DRAFT`                                |
| closed_by, closed_at                            | uuid, timestamp  | NN cuando `status` = `CLOSED`                               |
| created_at, updated_at, deleted_at, row_version |                  | Solo un `DRAFT` puede borrarse (lógicamente)                |

Restricciones: **a lo sumo una fila con `status = ACTIVE`** (RN-05; índice único
parcial). `CLOSED` exige `activated_at` y `closed_at ≥ activated_at`.

### `emergency_recipient` — convocado (snapshot al activar; replicado: solo los propios)

| Columna                 | Tipo           | Reglas                                                       |
| ----------------------- | -------------- | ------------------------------------------------------------ |
| id                      | uuid           | PK                                                           |
| emergency_id            | uuid           | FK `emergency`, NN                                           |
| brigadista_id           | uuid           | FK `brigadista_profile`, NN                                  |
| convoked_at             | timestamp      | NN. Igual a la activación                                    |
| current_response        | response_value | Nulo = **pendiente**                                         |
| current_response_id     | uuid           | FK `emergency_response`                                      |
| responded_at            | timestamp      | De la respuesta vigente                                      |
| first_seen_at           | timestamp      | Primer acuse del teléfono por cualquier vía (push o bandeja) |
| updated_at, row_version |                | NN                                                           |

Restricción: **U (`emergency_id`, `brigadista_id`)**. Se crea, en la misma
transacción que la activación, una fila por cada brigadista con cuenta activa,
sin considerar la disponibilidad (RN-06, RN-07).

### `emergency_response` — historial de respuestas (append-only, se crea en el teléfono)

| Columna              | Tipo           | Reglas                                                  |
| -------------------- | -------------- | ------------------------------------------------------- |
| id                   | uuid           | PK, generado en el dispositivo (idempotencia)           |
| recipient_id         | uuid           | FK `emergency_recipient`, NN                            |
| response             | response_value | NN                                                      |
| responded_at         | timestamp      | NN. Reloj del dispositivo                               |
| received_at          | timestamp      | NN. Reloj del servidor                                  |
| received_after_close | bool           | NN. Llegó cuando la convocatoria ya estaba cerrada (Q3) |
| device_id            | uuid           | FK `device`                                             |
| clock_adjusted       | bool           | NN                                                      |
| row_version          | bigint         | NN                                                      |

La respuesta vigente del convocado es la de mayor `responded_at` (desempate por
`id`), igual que la disponibilidad. Responder no modifica el perfil (RN-09).

### `notification_delivery` — entrega por canal y dispositivo

| Columna                                                                            | Tipo             | Reglas                           |
| ---------------------------------------------------------------------------------- | ---------------- | -------------------------------- |
| id                                                                                 | uuid             | PK                               |
| recipient_id                                                                       | uuid             | FK `emergency_recipient`, NN     |
| channel                                                                            | delivery_channel | NN                               |
| device_id                                                                          | uuid             | FK `device`; NN para `PUSH`      |
| status                                                                             | delivery_status  | NN. Etapa más avanzada alcanzada |
| queued_at, sent_at, provider_accepted_at, device_received_at, opened_at, failed_at | timestamp        | Un timestamp por etapa           |
| attempts                                                                           | integer          | NN                               |
| provider_message_id                                                                | text             | Opcional                         |
| last_error_code                                                                    | text             | Sin datos personales             |
| created_at, updated_at                                                             | timestamp        | NN                               |

Restricción: U (`recipient_id`, `channel`, `device_id`).
Correspondencia con el README: intento de envío = `SENT`; aceptación por el
proveedor = `PROVIDER_ACCEPTED`; entrega = `DEVICE_RECEIVED` (solo con acuse del
teléfono). La respuesta del usuario vive en `emergency_response`, no aquí.

### `device` — teléfono registrado

| Columna                 | Tipo            | Reglas                                                   |
| ----------------------- | --------------- | -------------------------------------------------------- |
| id                      | uuid            | PK. Identificador de instalación generado en el teléfono |
| user_id                 | uuid            | FK `app_user`, NN                                        |
| platform                | device_platform | NN                                                       |
| push_token              | text            | U cuando no es nulo                                      |
| push_token_updated_at   | timestamp       |                                                          |
| app_version, os_version | text            | Diagnóstico                                              |
| last_seen_at            | timestamp       | Última sincronización                                    |
| revoked_at              | timestamp       | Dispositivo dado de baja: no recibe push                 |
| created_at, updated_at  | timestamp       | NN                                                       |

### `auth_session` — sesión revocable

| Columna                                          | Tipo        | Reglas                                |
| ------------------------------------------------ | ----------- | ------------------------------------- |
| id                                               | uuid        | PK                                    |
| user_id                                          | uuid        | FK `app_user`, NN                     |
| client_type                                      | client_type | NN                                    |
| device_id                                        | uuid        | FK `device`; NN si `MOBILE`           |
| refresh_token_hash                               | text        | U, NN. Nunca el token en claro        |
| replaced_by_id                                   | uuid        | FK `auth_session`. Rotación de tokens |
| created_at, expires_at, last_used_at, revoked_at | timestamp   |                                       |

### `password_reset` — recuperación de contraseña

| Columna                         | Tipo      | Reglas                                          |
| ------------------------------- | --------- | ----------------------------------------------- |
| id                              | uuid      | PK                                              |
| user_id                         | uuid      | FK `app_user`, NN                               |
| token_hash                      | text      | U, NN                                           |
| requested_by                    | uuid      | FK `app_user`. Administrador que la generó (Q6) |
| expires_at, used_at, created_at | timestamp | Un solo uso                                     |

### `audit_log` — auditoría (append-only)

| Columna                | Tipo       | Reglas                                                                    |
| ---------------------- | ---------- | ------------------------------------------------------------------------- |
| id                     | uuid       | PK                                                                        |
| actor_user_id          | uuid       | FK `app_user`; nulo para acciones del sistema                             |
| action                 | text       | NN. Por ejemplo `EMERGENCY_ACTIVATED`, `USER_DEACTIVATED`, `LOGIN_FAILED` |
| entity_type, entity_id | text, uuid | Entidad afectada                                                          |
| metadata               | json       | Datos mínimos, sin secretos ni RUT completo                               |
| created_at             | timestamp  | NN                                                                        |

### `processed_operation` — idempotencia de la sincronización

| Columna            | Tipo             | Reglas                        |
| ------------------ | ---------------- | ----------------------------- |
| operation_id       | uuid             | PK. Enviado por el teléfono   |
| device_id, user_id | uuid             | FK, NN                        |
| operation_type     | text             | NN                            |
| result             | operation_result | NN                            |
| result_code        | text             | Motivo de rechazo o conflicto |
| entity_id          | uuid             | Registro creado o afectado    |
| received_at        | timestamp        | NN                            |

Si llega una operación con un `operation_id` ya registrado, se devuelve el
resultado guardado sin volver a aplicarla.

## 5. Entidades del teléfono (SQLite)

Réplica **parcial** y **propia** del brigadista. Las tablas replicadas reutilizan
las columnas del servidor (con los tipos portables de §2) más `sync_status`
cuando el registro puede nacer en el teléfono.

| Tabla                 | Contenido                                              | Origen              |
| --------------------- | ------------------------------------------------------ | ------------------- |
| `local_user`          | Una fila: id, nombre, rol. **Sin RUT** ni credenciales | Servidor            |
| `brigadista_profile`  | El perfil propio                                       | Servidor            |
| `availability_change` | Historial propio reciente + cambios pendientes         | Teléfono y servidor |
| `emergency`           | Convocatorias activas y recientes (Q9)                 | Servidor            |
| `emergency_recipient` | Las filas propias                                      | Servidor            |
| `emergency_response`  | Respuestas propias + pendientes                        | Teléfono y servidor |
| `outbox`              | Cola de operaciones pendientes                         | Teléfono            |
| `sync_state`          | Cursor de sincronización por ámbito                    | Teléfono            |

`sync_status` (solo en filas creadas en el teléfono): `PENDING` (en cola),
`SYNCED` (confirmada por el servidor), `REJECTED` (el servidor la rechazó;
se muestra al usuario, no se borra en silencio).

`outbox`:

| Columna         | Tipo        | Reglas                                                                              |
| --------------- | ----------- | ----------------------------------------------------------------------------------- |
| operation_id    | TEXT (uuid) | PK. Igual al `id` del registro creado cuando aplica                                 |
| operation_type  | TEXT        | `DECLARE_AVAILABILITY`, `RESPOND_EMERGENCY`, `ACK_RECIPIENT`, `REGISTER_PUSH_TOKEN` |
| payload         | TEXT (json) | Datos de la operación, sin secretos                                                 |
| created_at      | TEXT        | NN                                                                                  |
| attempts        | INTEGER     | NN                                                                                  |
| next_attempt_at | TEXT        | Reintento con espera progresiva                                                     |
| last_error      | TEXT        |                                                                                     |
| state           | TEXT        | `PENDING`, `IN_FLIGHT`, `FAILED_PERMANENT`                                          |

`sync_state`: `scope` (PK, por ejemplo `emergencies`, `profile`), `cursor`
(INTEGER, último `row_version` recibido), `last_success_at`.

Tokens de sesión: en **SecureStore**, nunca en SQLite.

## 6. Índices y restricciones previstos (no definitivos)

| Tabla                   | Índice / restricción                                                      | Propósito                  |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------- |
| `app_user`              | U `rut`; U parcial `email` no nulo; (`role`, `active`)                    | Login y listados           |
| `brigadista_profile`    | U `user_id`; (`availability_status`, `availability_declared_at`)          | Panel                      |
| `availability_change`   | (`brigadista_id`, `declared_at` desc)                                     | Historial                  |
| `emergency`             | U parcial `status = ACTIVE`; (`created_at` desc)                          | RN-05 y listado            |
| `emergency_recipient`   | U (`emergency_id`, `brigadista_id`); (`emergency_id`, `current_response`) | Unicidad y conteos         |
| `emergency_response`    | (`recipient_id`, `responded_at` desc)                                     | Respuesta vigente          |
| `notification_delivery` | U (`recipient_id`, `channel`, `device_id`); (`status`, `queued_at`)       | Reintentos                 |
| `device`                | U `push_token` no nulo; (`user_id`)                                       | Envío                      |
| `auth_session`          | U `refresh_token_hash`; (`user_id`)                                       | Renovación y revocación    |
| tablas replicadas       | (`row_version`)                                                           | Sincronización incremental |

### Lo que Prisma no expresa directamente

Se resolverá como **SQL manual dentro de la migración** de Prisma Migrate si la
versión de Prisma elegida no lo soporta:

- Índice único parcial de `emergency` (`status = ACTIVE`) y de `email`.
- Restricciones `CHECK` (coherencia de estados y fechas de `emergency`).
- Secuencia global y trigger que asigna `row_version` en cada inserción y
  actualización de las tablas replicadas.
- Protección append-only (revocar `UPDATE`/`DELETE` o trigger) en historial y auditoría.

## 7. Impacto en PostgreSQL y SQLite

| Aspecto         | PostgreSQL                         | SQLite                                                                       |
| --------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Alcance         | Modelo completo                    | Réplica parcial propia + cola                                                |
| Integridad      | FK, únicos, `CHECK`, transacciones | FK activadas (`PRAGMA foreign_keys = ON`), `CHECK` para enums                |
| Enums           | Tipo `enum` nativo vía Prisma      | `TEXT` + `CHECK`                                                             |
| Fechas          | `timestamptz` UTC                  | Texto ISO-8601 UTC de formato fijo                                           |
| Migraciones     | Prisma Migrate (backend)           | Migraciones propias de la app con `PRAGMA user_version` (mobile-architect)   |
| Datos sensibles | Hashes, RUT, auditoría             | Sin RUT, sin hashes; tokens en SecureStore; evaluar cifrado de la base local |
| Respaldo        | Backups diarios (devops)           | No es respaldo: se reconstruye desde el servidor                             |

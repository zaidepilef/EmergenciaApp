# Mapa de endpoints del MVP

> **Superado por el contrato v1** ([`openapi-v1.md`](openapi-v1.md)), que
> recorta el alcance al MVP aprobado y precisa algunas rutas (C1–C14). Se
> conserva como mapa de referencia. Texto original: es el mapa; el detalle de cada endpoint
> (entrada, salida, validaciones, errores) va en `backend/openapi/openapi.yaml`,
> que se escribe tras aprobar este mapa y se acuerda con mobile-architect y
> web-architect.

## 1. Autorización

| Capacidad | Condición, evaluada en el servidor en cada petición |
|---|---|
| `ADMIN` | `user_role` contiene `ADMINISTRADOR` |
| `COORD` | `user_role` contiene `COORDINADOR` |
| `BRIG` | `brigadista_profile.active = true` (independiente de los roles, Q1) |
| `AUTH` | Usuario activo, sesión `FULL` vigente y `credential_version` coincide |

Toda ruta exige `AUTH` salvo las marcadas como **pública** o **restringida**
(acepta una sesión `PASSWORD_CHANGE_ONLY`). Un usuario puede tener varias
capacidades a la vez.

Clientes: **M** = app móvil (`BRIGADISTA`, y coordinadores que también sean
brigadistas); **W** = dashboard web vía BFF (`COORDINADOR`, `ADMINISTRADOR`).

## 2. Autenticación y cuenta

| Método y ruta | Quién | Cliente | Propósito |
|---|---|---|---|
| `POST /v1/auth/login` | pública | M, W | RUT + contraseña → tokens. Móvil envía `device` (id, plataforma, versiones) |
| `POST /v1/auth/refresh` | pública (token de renovación) | M, W | Rota el token de renovación |
| `POST /v1/auth/logout` | restringida | M, W | Revoca la sesión actual (`LOGOUT`) |
| `POST /v1/auth/password` | restringida | M, W | Cambiar contraseña (obligatorio con provisoria) |
| `GET /v1/me` | restringida | M, W | Usuario, capacidades, `must_change_password`, perfil de brigadista |
| `GET /v1/me/devices` · `POST /v1/me/devices/{id}/revoke` | `AUTH` | M, W | Ver y revocar mis dispositivos (teléfono perdido, E14) |

El token push se registra por sync (`REGISTER_PUSH_TOKEN`), no por un endpoint
propio: así funciona también si el token cambia sin conexión.

## 3. Brigadista (app móvil)

La app escribe **solo por sync**; las lecturas también llegan por sync. Los
endpoints REST de esta sección son de respaldo y para el primer arranque.

| Método y ruta | Quién | Propósito |
|---|---|---|
| `POST /v1/sync/push` | `BRIG` o `AUTH` con dispositivo | Lote de operaciones: disponibilidad, respuesta, acuse, token push |
| `POST /v1/sync/pull` | `AUTH` con dispositivo | Cambios por ámbito desde los cursores del teléfono |
| `GET /v1/emergencies/active` | `BRIG` | Convocatoria activa propia con sus avisos y mi respuesta vigente (respaldo del push, E2) |

## 4. Coordinador (dashboard)

| Método y ruta | Propósito | Notas |
|---|---|---|
| `GET /v1/dashboard/summary` | Activos, conteo por disponibilidad, desactualizados (> 4 h), preparación de la brigada (sin dispositivo, push inválido, sin sincronizar, E10), revisiones pendientes | |
| `GET /v1/brigadistas` | Lista con disponibilidad, `stale`, dispositivos y último contacto | Filtros y paginación por cursor |
| `GET /v1/brigadistas/{id}/availability` | Historial de disponibilidad | |
| `POST /v1/me/availability` | Disponibilidad declarada desde la web por el propio usuario (`BRIG`, `source = WEB`) | Solo sobre sí mismo: el coordinador no declara por otro (`availability_source_chk`). Sin `sync_operation` (no hay dispositivo); idempotente por `Idempotency-Key` = id de la fila |
| `GET /v1/emergencies` | Historial de convocatorias | Paginado |
| `POST /v1/emergencies` | Crear borrador | |
| `GET /v1/emergencies/{id}` | Detalle con avisos | |
| `PATCH /v1/emergencies/{id}` | Editar borrador; en una activa, editar exige un aviso `UPDATE` (E6) | `If-Match` con `row_version` para no pisar a otro coordinador |
| `DELETE /v1/emergencies/{id}` | Descartar borrador (borrado lógico, `deleted_at`) | Solo `DRAFT` |
| `POST /v1/emergencies/{id}/activate` | Activar: convocados, aviso `ACTIVATION`, entregas `QUEUED` | `409 EMERGENCY_ALREADY_ACTIVE` (RN-05) |
| `POST /v1/emergencies/{id}/notices` | Aviso `UPDATE` con mensaje (segundo foco, cambio de punto, E6/E7) | |
| `POST /v1/emergencies/{id}/close` · `/reopen` | Cerrar (aviso `CLOSURE`) · reabrir si no hay otra activa (E8) | |
| `GET /v1/emergencies/{id}/recipients` | Estado por convocado: respuesta, acuse, entrega, contacto manual (estado derivado de `delivery-and-ack.md` §4) | Polling, ver §6 |
| `GET /v1/emergencies/active/summary` | Conteos `VOY` / `NO_PUEDO` / pendientes y "sin acuse" | Polling liviano, ver §6 |
| `POST /v1/emergencies/{id}/recipients` | Agregar convocado tarde (E5) | Motivo obligatorio |
| `POST /v1/recipients/{id}/responses` | Respuesta en nombre del brigadista (E3, `COORDINATOR_PROXY`) con canal y hora real | |
| `GET /v1/recipients/{id}/history` | Respuestas, acuses, entregas y contactos de un convocado | |
| `POST /v1/recipients/{id}/contacts` | Registrar contacto manual (E4) | |
| `GET /v1/sync-reviews` | Operaciones `CONFLICT`/`REJECTED` sin resolución final | |
| `POST /v1/sync-reviews/{operationId}/resolutions` | `NOTE`, `CONFIRMED`, `DISMISSED` o `CORRECTED` (crea respuesta correctiva) | |

## 5. Administrador (dashboard)

| Método y ruta | Propósito |
|---|---|
| `GET /v1/users` · `GET /v1/users/{id}` | Listar y ver cuentas (RUT completo solo aquí) |
| `POST /v1/users` | Alta con contraseña provisoria; responde la provisoria **una sola vez** |
| `PATCH /v1/users/{id}` | Nombre, correo, teléfono |
| `POST /v1/users/{id}/deactivate` · `/activate` | Desactivar (revoca sesiones) · reactivar. Con una convocatoria activa, la respuesta sugiere agregarlo como convocado (E5) |
| `POST /v1/users/{id}/reset-password` | Restablecer (Q6): nueva provisoria, revoca sesiones |
| `PUT /v1/users/{id}/roles/{role}` · `DELETE …` | Otorgar o quitar `ADMINISTRADOR` / `COORDINADOR` |
| `PUT /v1/users/{id}/brigadista-profile` · `POST …/deactivate` | Alta o baja de la condición de brigadista |
| `POST /v1/devices/{id}/revoke` | Revocar el dispositivo de otro usuario |
| `GET /v1/audit-log` | Auditoría filtrable por actor, entidad y fecha |

Se propone que el administrador no pueda quitarse a sí mismo el último rol
`ADMINISTRADOR` activo (`409 LAST_ADMIN`).

"Configuración general" (README §2) no tiene requisitos ni tablas: queda fuera
del MVP hasta que se defina (ver `plan.md`, D-B4).

## 6. Polling liviano del dashboard (10–15 s)

`GET /v1/emergencies/active/summary` y `GET /v1/emergencies/{id}/recipients`:

- Responden `ETag: "<sync_epoch>:<max_row_version>"`, donde el máximo se toma de
  `emergency`, `emergency_notice` y `emergency_recipient` de esa convocatoria.
  Es un `SELECT max(row_version)` sobre índices existentes.
- El BFF reenvía `If-None-Match`; si nada cambió, `304` sin cuerpo y sin armar
  el detalle.
- Limitación: acuses (`notice_ack`) y entregas (`notification_delivery`) no
  tienen `row_version`. Para que el `ETag` cambie con ellos, se suma
  `max(received_at)` de `notice_ack` y `max(updated_at)` de
  `notification_delivery` de la convocatoria. Ambos están indexados por
  `recipient_id`; con decenas de convocados el costo es despreciable.

## 7. Comunes

- Paginación por cursor opaco (`?cursor=…&limit=…`, máximo 100), nunca por
  `offset`.
- Fechas ISO 8601 en UTC con milisegundos.
- Los identificadores generados por el cliente (`device.id`, `operation_id`) son
  UUID; el servidor rechaza los que no lo sean.
- `GET /health/live`, `GET /health/ready` públicos y sin datos.

# Contrato preliminar de sincronización

> **PROPUESTA PARA ACORDAR** con database-architect (estrategia) y
> mobile-architect (cliente). Implementa
> [`strategy.md`](../database/synchronization/strategy.md),
> [`conflict-resolution.md`](../database/synchronization/conflict-resolution.md)
> y [`versioning.md`](../database/synchronization/versioning.md). La forma final
> queda en `openapi.yaml`.

## 1. Resumen

| Dirección | Endpoint | Garantía |
|---|---|---|
| Teléfono → servidor | `POST /v1/sync/push` | Cada operación se procesa sola y es idempotente por `operation_id` |
| Servidor → teléfono | `POST /v1/sync/pull` | Una instantánea coherente por descarga; entrega "al menos una vez" |

Ambos exigen sesión móvil (`client_type = MOBILE`); el `device_id` sale de la
**sesión**, no del cuerpo. Ambos devuelven `syncEpoch` y `serverTime`.

## 2. Envío: `POST /v1/sync/push`

### 2.1 Petición

```json
{
  "clock": { "deviceNow": "2026-11-13T12:00:05.120Z", "monotonicMs": 8400120, "bootSessionId": "b9c…" },
  "operations": [
    {
      "operationId": "0193…",          // UUID del teléfono (= id de la fila creada)
      "deviceSeq": 41,
      "type": "RESPOND_EMERGENCY",
      "declaredAt": "2026-11-13T11:58:40.000Z",
      "declaredMonotonicMs": 8315000,
      "bootSessionId": "b9c…",
      "baseRowVersion": 1834,
      "createdOffline": true,
      "payload": { "recipientId": "…", "response": "VOY" }
    }
  ]
}
```

| `type` | `payload` | Crea |
|---|---|---|
| `DECLARE_AVAILABILITY` | `{ status }` | `availability_change` (+ `brigadista_profile` si `APPLIED`) |
| `RESPOND_EMERGENCY` | `{ recipientId, response }` | `emergency_response` (+ `emergency_recipient` si `APPLIED`) |
| `ACK_NOTICE` | `{ noticeId, recipientId, level, via }` | `notice_ack` |
| `REGISTER_PUSH_TOKEN` | `{ token, platform }` | Actualiza `device` |

Límites: hasta **50** operaciones por lote, ordenadas por `deviceSeq`; cuerpo
máximo 256 KiB. Un lote más grande responde `413` y la app lo parte.

### 2.2 Procesamiento

Por operación, en orden de `deviceSeq`, **una transacción por operación** (una
operación inválida no arrastra a las demás):

1. ¿Existe `sync_operation` con ese `operation_id`?
   - Del mismo usuario → **repetida**: se devuelve el resultado guardado con
     `duplicate: true`, sin escribir nada.
   - De otro usuario → `REJECTED` `INVALID_PAYLOAD` (sin revelar nada más).
2. Validar el payload contra el esquema del contrato → si falla,
   `REJECTED` `INVALID_PAYLOAD`.
3. `replicatedWrite`: candado de versión **primero**; después
   `SELECT … FOR UPDATE` del `app_user` y de la fila base (convocado o perfil).
4. Autorizar: usuario activo y, para respuestas y acuses, que el convocado sea
   del usuario (`ACCOUNT_INACTIVE`, `NOT_A_RECIPIENT`).
5. Calcular `estimated_at` y `time_confidence` con el `clock` del lote
   (`conflict-resolution.md` §3; nunca en el futuro respecto de `received_at`).
6. Decidir `APPLIED` / `SUPERSEDED` / `CONFLICT` / `REJECTED` con
   `baseRowVersion` y las reglas de §5 de `conflict-resolution.md`, incluido el
   cierre de la convocatoria (`EMERGENCY_CLOSED`, `late_sync_after_close`).
7. Insertar `sync_operation` (siempre, también si es `REJECTED`) y la fila del
   dominio si no es `REJECTED`; actualizar la fila vigente si es `APPLIED`.
   `device.last_device_seq = max(actual, deviceSeq)`.
8. Si el acuse o la respuesta llegan, cancelar re-avisos pendientes de ese
   convocado (`push-delivery.md` §4).

Una operación de **disponibilidad** o **acuse** de un brigadista sin
convocatoria no toma `FOR UPDATE` sobre `emergency_recipient`.

### 2.3 Respuesta (`200` aunque haya rechazos)

```json
{
  "syncEpoch": "0193…",
  "serverTime": "2026-11-13T12:00:05.410Z",
  "results": [
    { "operationId": "0193…", "result": "APPLIED", "duplicate": false,
      "code": null, "entityId": "0193…", "rowVersion": 1902 }
  ]
}
```

| `result` | `code` posibles | Acción en el teléfono (`strategy.md` §2) |
|---|---|---|
| `APPLIED` | — | `SYNCED`; borrar de `outbox` |
| `SUPERSEDED` | — | `SYNCED`; refrescar (otra declaración más nueva manda) |
| `CONFLICT` | `AMBIGUOUS_ORDER`, `LATE_AFTER_CLOSE` | `SYNCED`; refrescar; el coordinador revisa |
| `REJECTED` | `EMERGENCY_CLOSED`, `NOT_A_RECIPIENT`, `ACCOUNT_INACTIVE`, `INVALID_PAYLOAD`, `SEQ_CONFLICT` | `REJECTED`; mostrar el motivo; no reintentar |

Errores HTTP del lote completo: `401` (sesión inválida; la app renueva o vuelve
al login), `403 DEVICE_REVOKED` (la app cierra sesión), `413`, `429`, `5xx`
(reintentar con espera progresiva: es seguro por idempotencia). Si la cuenta
está inactiva, la respuesta es `200` con cada operación `ACCOUNT_INACTIVE` para
que la app muestre el motivo, y la siguiente renovación falla.

### 2.4 Pendiente con database-architect: `device_seq`

`sync_operation_seq_uq` (`device_id`, `device_seq`) es único. Si llega un
`operation_id` **nuevo** con un `deviceSeq` ya usado por otra operación (base
local recreada sin cambiar `device.id`, error del cliente), la inserción falla.
Propuesta: `REJECTED` `SEQ_CONFLICT` **sin** guardar en `sync_operation`
(no se puede, por la restricción), con registro en `audit_log`, y la app debe
generar un `device.id` nuevo al recrear su base. Es la única operación
rechazada que no queda en `sync_operation`; requiere aprobación de
database-architect.

## 3. Descarga: `POST /v1/sync/pull`

Es `POST` porque lleva varios cursores; no tiene efectos (salvo
`device.last_seen_at`).

```json
{ "syncEpoch": "0193…", "cursors": { "profile": 1700, "availability": 1650,
  "emergencies": 1800, "notices": 1801, "recipients": 1834, "responses": 1834 },
  "limit": 200 }
```

Respuesta:

```json
{
  "syncEpoch": "0193…", "epochChanged": false, "serverTime": "…",
  "scopes": {
    "recipients": { "rows": [ … ], "cursor": 1902, "hasMore": false }
  },
  "lateAdditions": [ { "emergency": { … }, "notices": [ … ] } ]
}
```

Reglas (`versioning.md` §4):

1. Toda la descarga es **una** transacción `REPEATABLE READ READ ONLY`.
2. Por ámbito: `WHERE row_version > :cursor ORDER BY row_version LIMIT :limit`,
   filtrado a lo que el usuario puede ver. El cursor nuevo es el `row_version`
   de la última fila devuelta.
3. Si `syncEpoch` del teléfono no coincide (o es nulo), `epochChanged: true`,
   se ignoran sus cursores y se descarga desde 0. La app además reenvía sus
   registros de los últimos 7 días (idempotente).
4. **Convocado agregado tarde (E5):** para cada `emergency_recipient` del
   usuario que aparece en la página, si su convocatoria no está en el teléfono,
   va completa en `lateAdditions` sin importar su versión. El servidor no sabe
   qué tiene el teléfono, así que lo incluye para **todo** convocado cuya
   convocatoria tenga `row_version` ≤ cursor de `emergencies`; repetirlo es
   inofensivo (upsert).
5. Retiros: convocatoria descartada → lápida (`deleted_at`); el teléfono la
   borra.

| Ámbito | Filas | Filtro |
|---|---|---|
| `profile` | Mi `app_user` (nombre, roles, flags; **sin RUT ni hash**) y mi `brigadista_profile` | `id = yo` |
| `availability` | Mis `availability_change` | `brigadista_id = mi perfil` |
| `emergencies` | Convocatorias no `DRAFT` en las que soy convocado | vía `emergency_recipient` |
| `notices` | Avisos de esas convocatorias | ídem |
| `recipients` | **Mis** filas de convocado (respuesta vigente) | `brigadista_id = mi perfil` |
| `responses` | Mis respuestas, incluidas las registradas por el coordinador en mi nombre | vía `recipient_id` |

El teléfono **no** recibe datos de otros brigadistas (`security.md` §5).

Optimización pendiente de medir: los ámbitos `emergencies` y `notices` usan
índices por `row_version` globales y luego filtran por convocado. Con una
brigada y decenas de convocatorias es irrelevante; si crece, se agrega un
índice o se cambia el filtro.

## 4. Revisión pedida a database-architect

1. Orden de candados: versión → `app_user` → fila base, en sync (§2.2) y en
   toda transacción que escriba una tabla replicada. Dos casos de
   autenticación:
   - **Login** actualiza `app_user.last_login_at` y `app_user` es replicada:
     el trigger tomaría el candado de versión **después** del candado de fila,
     invirtiendo el orden y arriesgando un interbloqueo con una operación de
     sync. Propuesta: el login usa `replicatedWrite` (candado de versión
     primero).
   - **Renovación** bloquea `app_user` (`FOR UPDATE`) pero solo escribe
     `auth_session`, que no es replicada: nunca espera el candado de versión,
     así que no forma ciclo. Se queda sin él.
2. `SEQ_CONFLICT` (§2.4).
3. Inclusión de `lateAdditions` (§3.4).
4. Si `app_user.last_login_at` debe dejar de disparar `row_version` (relacionado
   con la propuesta H9 de `review-checklist.md` §5.4): hoy cada login genera un
   cambio replicado sin interés para el teléfono.

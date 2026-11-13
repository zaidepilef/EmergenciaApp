# Escenarios de falla — prueba de estrés del modelo

> **Estado: PROPUESTA PRELIMINAR — pendiente de aprobación.**
> Supuesto de partida: **todo lo que puede fallar, falla durante un incendio**.
> El sistema no puede garantizar que alguien se entere; sí puede garantizar que el
> coordinador **sepa a quién no le llegó** y que **ningún dato se pierda**.

## 1. Principio rector

La app es **un canal más**, no el único. Cuando falla, el coordinador vuelve a la
llamada, la radio o el aviso en persona, y el modelo debe permitir **registrar lo
que pasó por fuera de la app** con la hora real en que ocurrió.

Tres preguntas que el panel debe poder responder en todo momento:

1. ¿A quién **no le ha llegado** la convocatoria (sin acuse)?
2. ¿Quién **no ha respondido**?
3. ¿Quién **está realmente en terreno**? (ver E9, requiere aprobación)

## 2. Escenarios

| #   | Escenario                                                                                                      | Qué pasaba con el modelo anterior                                                                                        | Cambio propuesto                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **El push no llega** (teléfono apagado, ahorro de batería, sin datos, token vencido)                           | El panel mostraba "pendiente" igual para quien no recibió y para quien no quiso responder                                | El panel separa **sin acuse** de **sin respuesta**. `notification_delivery` registra fallos del proveedor (token inválido → dispositivo marcado). Re-aviso automático a quien siga sin acuse (política en §4)                                                                                  |
| E2  | **Sin Internet un rato** y luego vuelve                                                                        | Cubierto por la cola local                                                                                               | Sin cambios. Al reconectar, la app consulta siempre las convocatorias activas, aunque no haya llegado push                                                                                                                                                                                     |
| E3  | **Alguien le avisó** (boca a boca, WhatsApp, radio) y no tiene la convocatoria en el teléfono                  | No podía responder: la respuesta exige la convocatoria sincronizada                                                      | **Respuesta registrada por el coordinador** en nombre del brigadista, con canal (`PHONE_CALL`, `RADIO`, `IN_PERSON`, `OTHER`) y hora real. Si el brigadista tiene datos, abrir la app descarga la convocatoria activa                                                                          |
| E4  | **El coordinador llamó y no contestó**                                                                         | No había dónde anotarlo                                                                                                  | Nuevo **registro de contacto manual** (`manual_contact`): quién, a quién, canal, resultado (`ANSWERED`, `NO_ANSWER`, `MESSAGE_LEFT`) y hora                                                                                                                                                    |
| E5  | **Brigadista no incluido en la convocatoria** (cuenta activada después, desactivado por error, recién llegado) | El snapshot era cerrado: no se podía agregar                                                                             | El coordinador puede **agregar convocados tarde**, con motivo y autor. Reactivar una cuenta durante una emergencia activa propone agregarla                                                                                                                                                    |
| E6  | **Cambia el punto de encuentro** o la situación empeora                                                        | Editar la convocatoria no avisaba a nadie ni dejaba rastro                                                               | Nueva entidad **aviso** (`emergency_notice`): `ACTIVATION`, `UPDATE`, `CLOSURE`, `REOPEN`. Cada aviso tiene sus propias entregas y acuses. Las ediciones quedan en historial                                                                                                                   |
| E7  | **Segundo incendio** mientras hay uno activo                                                                   | RN-05 impide una segunda convocatoria activa                                                                             | **Decisión del usuario** (P1): mantener RN-05 y comunicar el segundo foco como aviso `UPDATE`, o permitir varias activas                                                                                                                                                                       |
| E8  | **Cerraron la convocatoria por error**                                                                         | `CLOSED` era final                                                                                                       | Permitir **reabrir** (aviso `REOPEN`, auditado) si no hay otra activa                                                                                                                                                                                                                          |
| E9  | **Respondió `VOY` y nunca llegó** (o se accidentó)                                                             | `VOY` no equivale a presencia (RN-09); nadie sabe quién está en el lugar                                                 | Propuesta: **control de presencia** (`emergency_attendance`): llegada y retiro registrados por el coordinador. Es seguridad de personas en un incendio. **Requiere aprobación** (P2): no está en el README                                                                                     |
| E10 | **El brigadista nunca instaló la app** o cerró sesión                                                          | Recibía cero avisos sin que nadie lo notara                                                                              | El panel muestra **preparación de la brigada** antes de cualquier emergencia: brigadistas activos sin dispositivo, con push desactivado o sin sincronizar hace días                                                                                                                            |
| E11 | **Servidor caído** durante el incendio                                                                         | Todo se detenía                                                                                                          | No se puede evitar con datos. Sí: la app muestra "no se puede contactar al servidor, llama al coordinador"; el coordinador usa el plan manual; después **registra a posteriori** respuestas y contactos con su hora real (`occurred_at` ≠ `recorded_at`). Monitoreo y alerta: devops-architect |
| E12 | **El coordinador se queda sin Internet**                                                                       | No puede activar (dashboard en línea)                                                                                    | El dashboard funciona en el navegador del celular con datos móviles. Recomendación: **al menos dos coordinadores** activos. Sin cambio de modelo                                                                                                                                               |
| E13 | **Se restaura un backup del servidor**                                                                         | Los cursores de los teléfonos quedaban adelantados: dejarían de recibir cambios; lo enviado después del backup se perdía | **Época de sincronización** (`sync_epoch`): cambia al restaurar. El teléfono que detecta otra época descarga todo de nuevo y **reenvía sus propios registros** recientes (idempotente) para recuperar lo perdido                                                                               |
| E14 | **Teléfono perdido o robado**                                                                                  | Cubierto: revocar dispositivo y sesión                                                                                   | Sin cambios. La base local no contiene RUT ni datos de terceros                                                                                                                                                                                                                                |
| E15 | **Responde sin conexión antes del cierre y sincroniza después**                                                | Cubierto (`received_after_close`)                                                                                        | Sin cambios                                                                                                                                                                                                                                                                                    |
| E16 | **El brigadista y el coordinador registran respuestas distintas** (E3 + la app)                                | Antes había un solo escritor                                                                                             | Gana la de **hora real** más reciente; ambas quedan en el historial y el panel marca la discrepancia                                                                                                                                                                                           |
| E17 | **Usuario desactivado con una emergencia activa**                                                              | Sus operaciones se rechazaban                                                                                            | Se mantiene el rechazo de operaciones nuevas, pero **su fila de convocado y su historial se conservan**                                                                                                                                                                                        |

## 3. Cambios al modelo lógico

### Nuevo: `emergency_notice` — aviso emitido sobre una convocatoria (replicado)

| Columna                 | Tipo        | Reglas                                                  |
| ----------------------- | ----------- | ------------------------------------------------------- |
| id                      | uuid        | PK                                                      |
| emergency_id            | uuid        | FK `emergency`, NN                                      |
| kind                    | notice_kind | `ACTIVATION`, `UPDATE`, `CLOSURE`, `REOPEN`             |
| message                 | text        | Texto del aviso (por ejemplo, nuevo punto de encuentro) |
| created_by              | uuid        | FK `app_user`, NN                                       |
| created_at, row_version |             | NN                                                      |

`notification_delivery` pasa a referenciar **`notice_id`** además de
`recipient_id`: U (`notice_id`, `recipient_id`, `channel`, `device_id`).
El acuse (`ACK`) del teléfono también es por aviso: `notice_ack` (notice_id,
recipient_id, acked_at, received_at). `emergency_recipient.first_seen_at` se
mantiene como resumen del primer acuse.

### Cambios en `emergency_recipient`

| Columna      | Tipo             | Reglas                                           |
| ------------ | ---------------- | ------------------------------------------------ |
| convoked_at  | timestamp        | NN. Activación **o** incorporación tardía        |
| added_reason | recipient_reason | `ACTIVATION`, `LATE_ADDITION`                    |
| added_by     | uuid             | FK `app_user`; nulo si fue el sistema al activar |

### Cambios en `emergency_response`

| Columna      | Tipo            | Reglas                                                                                                |
| ------------ | --------------- | ----------------------------------------------------------------------------------------------------- |
| source       | response_source | `APP` (el brigadista) o `COORDINATOR` (registrada en su nombre)                                       |
| channel      | contact_channel | `APP`, `PHONE_CALL`, `RADIO`, `IN_PERSON`, `OTHER`                                                    |
| recorded_by  | uuid            | FK `app_user`. Coordinador que la registró, si `source = COORDINATOR`                                 |
| responded_at | timestamp       | Hora **real** en que el brigadista respondió (declarada por el coordinador en registros a posteriori) |

### Nuevo: `manual_contact` — contacto fuera de la app (append-only)

| Columna      | Tipo            | Reglas                                  |
| ------------ | --------------- | --------------------------------------- |
| id           | uuid            | PK                                      |
| recipient_id | uuid            | FK `emergency_recipient`, NN            |
| channel      | contact_channel | NN, distinto de `APP`                   |
| outcome      | contact_outcome | `ANSWERED`, `NO_ANSWER`, `MESSAGE_LEFT` |
| occurred_at  | timestamp       | NN. Hora real                           |
| recorded_by  | uuid            | FK `app_user`, NN                       |
| recorded_at  | timestamp       | NN                                      |
| note         | text            | Opcional, sin datos sensibles           |

### Nuevo (si se aprueba P2): `emergency_attendance` — presencia en terreno

| Columna      | Tipo             | Reglas                       |
| ------------ | ---------------- | ---------------------------- |
| id           | uuid             | PK                           |
| recipient_id | uuid             | FK `emergency_recipient`, NN |
| event        | attendance_event | `ARRIVED`, `LEFT`            |
| occurred_at  | timestamp        | NN                           |
| recorded_by  | uuid             | FK `app_user`, NN            |
| recorded_at  | timestamp        | NN                           |

Append-only; "en terreno" = último evento `ARRIVED` sin `LEFT` posterior. No
modifica la disponibilidad (`EN_SERVICIO` sigue siendo una declaración del
brigadista).

### Cambios en `emergency`

- Estados: `DRAFT` → `ACTIVE` → `CLOSED` → (`ACTIVE` por reapertura). Cada
  transición genera un `emergency_notice` y una entrada en `audit_log`.
- Las ediciones de campos estando `ACTIVE` generan un aviso `UPDATE`.

### Nuevo: época de sincronización

- `sync_epoch` (uuid) global del servidor, guardado en una tabla de
  configuración de una fila; cambia en cada restauración de backup.
- Cada respuesta de sincronización incluye la época; el teléfono la guarda en
  `sync_state`.

### Nuevas enumeraciones

`notice_kind`, `recipient_reason`, `response_source`, `contact_channel`,
`contact_outcome` y, si se aprueba, `attendance_event`.

## 4. Re-aviso (política a definir con backend y UX)

Propuesta inicial: a quien siga **sin acuse**, reenviar el push del aviso de
activación a los 2, 5 y 10 minutos, y luego avisar al coordinador para contacto
manual. Se detiene al llegar el acuse o una respuesta. El modelo lo soporta con
`notification_delivery.attempts` y los timestamps por etapa.

## 5. Decisiones para el usuario

| #   | Pregunta                                                              | Recomendación                                                                                    |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P1  | ¿Puede haber **dos convocatorias activas** a la vez (dos focos)?      | Mantener RN-05 en el MVP y comunicar el segundo foco como aviso `UPDATE`; revisar con la brigada |
| P2  | ¿Se agrega **control de presencia** en terreno (llegó / se retiró)?   | **Sí**: es la pregunta más importante en un incendio y el costo es una tabla                     |
| P3  | ¿Un **canal alternativo automático** (SMS) para quien siga sin acuse? | Fuera del MVP por costo; el modelo ya lo admite con `delivery_channel`                           |
| P4  | ¿Cuántos **coordinadores** como mínimo?                               | Dos o más, para que una caída de conexión no impida activar                                      |

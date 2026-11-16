# Seguridad de datos

> **PROPUESTA PARA AUDITORÍA.** Responde al punto 3: contraseñas provisorias y
> revocación de sesiones. La lógica la implementa backend-architect; aquí se
> define qué debe garantizar la base y qué debe probarse.

## 1. Clasificación

| Nivel     | Datos                                     | Dónde vive                                                                              |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Secreto   | `password_hash`, `refresh_token_hash`     | Solo servidor, siempre como hash. Nunca en logs, auditoría, payloads ni teléfono        |
| Personal  | RUT, nombre, correo, teléfono             | Servidor. El teléfono guarda solo el nombre propio. RUT enmascarado en logs y auditoría |
| Operativo | Disponibilidad, respuestas, convocatorias | Servidor y réplica propia en el teléfono                                                |
| Técnico   | Dispositivo, token push, operaciones      | Servidor                                                                                |

## 2. Contraseña provisoria (Q6)

Flujo de restablecimiento iniciado por un administrador, **en una sola
transacción**:

1. `SELECT ... FROM app_user WHERE id = :id FOR UPDATE` (serializa con cualquier
   renovación de sesión en curso, §3).
2. `password_hash` = Argon2id de la contraseña provisoria; la anterior deja de
   servir en ese instante.
3. `must_change_password = true`, `password_expires_at = now() + 72 h` (plazo a
   confirmar).
4. `credential_version = credential_version + 1`.
5. Revocar todas las sesiones abiertas: `revoked_at = now()`,
   `revoked_reason = 'PASSWORD_RESET'`.
6. `audit_log` con actor, usuario afectado y acción; **sin** la contraseña.

La contraseña provisoria se muestra **una sola vez** al administrador; no se
guarda en claro, no se envía por la API después y no aparece en logs.

| Garantía                                           | Cómo                                                                                                                                                 | Dónde                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Provisoria siempre vence                           | `must_change_password = (password_expires_at IS NOT NULL)`                                                                                           | `CHECK` en la base        |
| Vencida no sirve                                   | Login rechazado si `must_change_password` y `now() > password_expires_at`                                                                            | Backend                   |
| Con provisoria solo se puede cambiar la contraseña | La sesión nace con `scope = 'PASSWORD_CHANGE_ONLY'`; todo endpoint exige `FULL` salvo el de cambio                                                   | Backend + columna `scope` |
| La nueva no puede ser la provisoria                | Se verifica contra el hash vigente antes de reemplazarlo                                                                                             | Backend                   |
| Al cambiarla                                       | Nuevo hash, `must_change_password = false`, `password_expires_at = NULL`, `credential_version + 1`, revocar la sesión restringida, emitir una `FULL` | Backend, una transacción  |
| Alta de cuenta nueva                               | Nace con contraseña provisoria (mismo flujo)                                                                                                         | Backend                   |

## 3. Revocación de sesiones

Sesión = token de acceso de vida corta (minutos) + token de renovación guardado
como hash en `auth_session`.

| Amenaza                                                                                             | Control                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renovación en paralelo con el restablecimiento: la sesión vieja rota y crea una nueva que sobrevive | La renovación también hace `SELECT ... FOR UPDATE` sobre `app_user` y exige `auth_session.credential_version = app_user.credential_version`. El restablecimiento sube la versión: cualquier renovación posterior falla, y las simultáneas quedan en serie por el candado de fila |
| Token de renovación robado y reutilizado                                                            | Rotación: cada uso crea una sesión nueva (`replaced_by_id`). Presentar un token ya reemplazado revoca **toda la familia** (`family_id`) con motivo `REUSE_DETECTED`                                                                                                              |
| Token de acceso aún vigente tras desactivar o restablecer                                           | Vida corta (máximo 10 min, a confirmar) y las operaciones sensibles vuelven a leer `active` y `credential_version` en la base                                                                                                                                                    |
| Teléfono perdido                                                                                    | Revocar el `device`: sus sesiones se revocan (`DEVICE_REVOKED`) y deja de recibir push                                                                                                                                                                                           |
| Usuario desactivado                                                                                 | `active = false`, `credential_version + 1`, sesiones revocadas, operaciones de sincronización rechazadas con `ACCOUNT_INACTIVE`                                                                                                                                                  |
| Cambio de rol                                                                                       | No revoca sesiones; aplica en la siguiente verificación del servidor, que nunca confía en el rol del token                                                                                                                                                                       |

Motivos de revocación (`revoked_reason`): `LOGOUT`, `ROTATED`,
`PASSWORD_RESET`, `PASSWORD_CHANGED`, `ACCOUNT_DEACTIVATED`, `DEVICE_REVOKED`,
`REUSE_DETECTED`, `EXPIRED`.

## 4. Pruebas obligatorias (backend-architect)

1. Tras restablecer, la contraseña anterior y todas las sesiones previas fallan.
2. Renovación concurrente con restablecimiento: ninguna sesión emitida queda
   válida (prueba con dos conexiones y pausas forzadas).
3. Con contraseña provisoria, cualquier endpoint distinto del cambio responde 403.
4. Provisoria vencida: login rechazado con mensaje genérico.
5. Reutilizar un token de renovación revoca la familia completa.
6. Desactivar: renovación rechazada y operaciones de sync `ACCOUNT_INACTIVE`.
7. Ningún log, auditoría ni payload contiene contraseñas, hashes ni tokens.

## 5. Teléfono

- Tokens en SecureStore, nunca en SQLite.
- La base local no contiene RUT, hashes ni datos de terceros.
- Al cerrar sesión (con confirmación si hay pendientes) se borran la base local y
  los tokens.
- Cifrado de la base local: a evaluar por mobile-architect; los datos guardados
  son de baja sensibilidad por diseño.

## 6. Retención (Q8)

Sin eliminación de historial en el MVP. Antes de producción debe definirse la
retención de auditoría, sesiones vencidas y datos de cuentas desactivadas.

**Al definir la retención de `audit_log`** deben incluirse explícitamente las
entradas de operaciones de sincronización que no tienen fila en
`sync_operation` (`contract-v1-review.md` §2):

- `SYNC_OPERATION_UNSUPPORTED`: tipo de operación que el modelo no conoce (una
  por `operationId`).
- `operationId` que ya pertenece a otro usuario (`REJECTED INVALID_PAYLOAD`;
  una por `operationId`; el nombre de la acción lo fija backend-architect).
- `SYNC_DEVICE_SEQ_CONFLICT`: lote rechazado con `409 DEVICE_SEQ_CONFLICT` (una
  por dispositivo y lote).

Llevan solo la lista cerrada de metadatos (sin payload), pero incluyen
identificadores de usuario y dispositivo, y `audit_log` es append-only: la
regla de retención que se apruebe debe decir qué pasa con ellas. Esta nota no
define la retención; queda pendiente (Q8).

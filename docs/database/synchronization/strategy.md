# Estrategia de sincronización (preliminar)

> **Estado: PROPUESTA PRELIMINAR — pendiente de aprobación.** Define la estrategia
> desde la persistencia; el contrato HTTP lo acuerdan backend-architect y
> mobile-architect.

## 1. Principios

1. **El servidor es la fuente de verdad.** El teléfono guarda una réplica parcial
   y una cola de operaciones.
2. **Nada se pierde en silencio.** Una operación rechazada queda visible para el
   usuario con su motivo.
3. **Reintentar nunca duplica.** Cada operación lleva un UUID generado en el
   teléfono; el servidor recuerda las ya procesadas.
4. **Pocos escritores por dato.** Cada dato sincronizable tiene un solo dueño, lo
   que elimina casi todos los conflictos (ver §4).
5. **Sin conexión, la app sigue siendo útil:** muestra lo último conocido con su
   antigüedad y acepta declarar disponibilidad y responder.

## 2. Envío (teléfono → servidor)

1. La acción del usuario se guarda **en una sola transacción SQLite**: la fila
   (con `sync_status = PENDING`) y su entrada en `outbox`.
2. Con conexión, la app envía las operaciones pendientes en lotes, en orden de
   creación.
3. El servidor procesa **cada operación por separado** (validación y
   autorización propias) y responde por operación:

   | Resultado          | Significado                                               | Acción en el teléfono                                        |
   | ------------------ | --------------------------------------------------------- | ------------------------------------------------------------ |
   | `APPLIED`          | Aplicada                                                  | `sync_status = SYNCED`; borrar de `outbox`                   |
   | (repetida)         | `operation_id` ya procesado                               | Igual que `APPLIED`, con el resultado original               |
   | `REJECTED`         | Inválida o sin permiso (por ejemplo, usuario desactivado) | `sync_status = REJECTED`; mostrar al usuario; no reintentar  |
   | `CONFLICT`         | Aplicada en el historial pero no cambió el estado vigente | `SYNCED`; refrescar desde el servidor                        |
   | Error de red o 5xx | No se sabe si llegó                                       | Reintentar con espera progresiva; es seguro por idempotencia |

4. Si la app se cierra a mitad de un envío, las operaciones `IN_FLIGHT` vuelven a
   `PENDING` al abrirla.

## 3. Recepción (servidor → teléfono)

- Cada fila replicable tiene `row_version`, tomado de una secuencia global de
  PostgreSQL en cada inserción o actualización.
- El teléfono pide "cambios con `row_version` mayor que mi cursor" por ámbito
  (`profile`, `emergencies`, `recipients`, `responses`, `availability`) y
  actualiza el cursor solo después de guardar todo en una transacción local.
- Para no perder filas de transacciones que confirman fuera de orden, la consulta
  relee una pequeña ventana anterior al cursor; aplicar la misma fila dos veces es
  inofensivo (upsert por `id`).
- Los retiros viajan como lápidas (`deleted_at`) y el teléfono borra o archiva la
  fila local.
- Disparadores de recepción: abrir la app, recuperar la conexión, recibir un push
  y un intervalo periódico en primer plano.
- **Respaldo del push:** al reconectar, la app siempre consulta las convocatorias
  activas. Un push perdido no impide ver la convocatoria (bandeja interna).

## 4. Conflictos

| Dato                                           | Escritores                                      | Política                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disponibilidad                                 | Solo el brigadista (uno o más teléfonos, o web) | **Última declaración gana** por `declared_at`; desempate por `id`. Todas quedan en el historial                                                   |
| Respuesta                                      | Solo el brigadista                              | Igual que disponibilidad, por `responded_at`                                                                                                      |
| Respuesta tras el cierre                       | —                                               | Se guarda con `received_after_close = true`; no cambia la respuesta vigente si la convocatoria ya está cerrada; el coordinador la ve marcada (Q3) |
| Convocatoria, perfil                           | Solo el servidor                                | El teléfono no los modifica: sin conflicto                                                                                                        |
| Usuario desactivado con operaciones pendientes | —                                               | `REJECTED`; el teléfono muestra el motivo y cierra la sesión                                                                                      |

**Relojes de los teléfonos:** no son confiables. El servidor guarda siempre
`received_at`. Si una fecha del teléfono viene en el futuro (más allá de una
tolerancia, por ejemplo 2 minutos), se reemplaza por `received_at` y se marca
`clock_adjusted = true`. El orden entre declaraciones de un mismo brigadista sigue
la fecha del teléfono porque refleja la intención del usuario.

## 5. Acuse de recepción

- Al recibir un push o al ver la convocatoria por primera vez en la bandeja, la
  app encola `ACK_RECIPIENT`.
- El servidor fija `emergency_recipient.first_seen_at` y, si vino por push,
  `notification_delivery.device_received_at`.
- La interfaz y el panel **solo** muestran "recibida" cuando existe ese acuse.

## 6. Recuperación

- **Reinstalación o teléfono nuevo:** nuevo `device`; la réplica se reconstruye
  completa desde el servidor. Las operaciones pendientes del teléfono anterior se
  pierden si nunca llegaron: se advierte al cerrar sesión con operaciones en cola.
- **Cierre de sesión:** se avisa si hay operaciones pendientes; al confirmar se
  borran la base local y los tokens.
- **Base local corrupta o migración fallida:** se descarta la réplica y se
  vuelve a descargar; solo se pierde la `outbox` no enviada, por lo que se
  intenta enviarla antes.

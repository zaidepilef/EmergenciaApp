# Almacenamiento sin conexión

> **PROPUESTA PARA REVISIÓN.** Cubre los puntos 1, 2, 4 y 6: cola persistente,
> duplicados, operaciones rechazadas y limpieza protegida. Tablas en
> [`../sqlite/schema.md`](../sqlite/schema.md).

## 1. Registrar una acción (punto 1)

Todo en **una sola transacción SQLite**:

1. Leer y aumentar `device_identity.next_device_seq`.
2. Insertar el registro (por ejemplo `emergency_response`) con
   `sync_status = 'PENDING'` y un UUID v7 nuevo.
3. Insertar en `outbox` con `operation_id` = ese UUID, el `device_seq`, el
   payload, `base_row_version`, `declared_at`, reloj monotónico y arranque.

Si el teléfono se apaga a mitad de camino, la transacción no se confirma y no
queda nada a medias. Con `synchronous = FULL`, lo confirmado sobrevive a un corte
de batería.

## 2. Estados de una operación

```
PENDING ──envío──▶ IN_FLIGHT ──APPLIED / SUPERSEDED / CONFLICT──▶ APPLIED ──▶ (se borra)
   ▲                   │
   └── error de red ───┤
                       └──REJECTED──▶ REJECTED ──el usuario lo ve──▶ REJECTED_ACKNOWLEDGED ──30 días──▶ (se borra)
```

- Al abrir la app, toda operación `IN_FLIGHT` vuelve a `PENDING`: no se sabe si
  llegó, y reenviarla es seguro.
- Se envía en orden de `device_seq`. Un rechazo no bloquea las siguientes.
- Reintentos con espera progresiva (por ejemplo 5 s, 15 s, 1 min, 5 min), y
  siempre inmediatamente al recuperar conexión.
- `SUPERSEDED` y `CONFLICT` también confirman la operación: el dato quedó en el
  servidor; el teléfono descarga la versión vigente.

## 3. Duplicados (punto 2)

| Capa       | Protección                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teléfono   | `operation_id` PK y `device_seq` UNIQUE en `outbox`; un botón presionado dos veces genera dos operaciones distintas y ordenadas, nunca una repetida |
| Servidor   | `sync_operation.operation_id` PK: si ya existe, devuelve el resultado guardado sin volver a aplicar; U (`device_id`, `device_seq`)                  |
| Registros  | El registro creado usa el mismo UUID: `emergency_response.id`, `availability_change.id`, `notice_ack.id`                                            |
| Acuses     | U (`notice_id`, `recipient_id`, `device_id`) en el servidor y U `notice_id` en el teléfono                                                          |
| Envío push | U (`notice_id`, `recipient_id`, `channel`, `device_id`) en `notification_delivery`                                                                  |

El servidor también detecta **huecos**: si recibe `device_seq` 12 y el último
fue 10, lo registra (falta la 11) sin bloquear; la 11 puede llegar después.

## 4. Operaciones rechazadas (punto 4)

- **Teléfono:** la operación queda `REJECTED` y el registro con
  `sync_status = 'REJECTED'`. La app lo muestra con el motivo hasta que el
  usuario lo confirma (`REJECTED_ACKNOWLEDGED`), y lo conserva 30 días más.
  Nunca se elimina sin que el usuario lo haya visto.
- **Servidor:** `sync_operation` guarda payload, motivo y
  `resolution_status = 'PENDING_REVIEW'`. El coordinador lo resuelve (por ejemplo,
  registrando la respuesta a nombre del brigadista) y queda `RESOLVED` con autor,
  fecha y nota. No se borra (Q8).
- Un rechazo **no** reintenta automáticamente: repetirlo daría el mismo resultado.

## 5. Limpieza local (Q9 y punto 6)

| Se limpia                   | Condición                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| Convocatorias cerradas      | `closed_at` de más de 30 días **y** sin operaciones en `outbox` **y** todas sus filas sincronizadas |
| Historial de disponibilidad | `SYNCED` y de más de 30 días                                                                        |
| Operaciones rechazadas      | `REJECTED_ACKNOWLEDGED` hace más de 30 días                                                         |

**Nunca** se limpia: una convocatoria activa, nada `PENDING`, `IN_FLIGHT` o
`REJECTED`, ni sus convocatorias asociadas. La base lo impide por sí misma con
la FK `RESTRICT` de `outbox` y los triggers de `sqlite/schema.md` §3, aunque el
código de limpieza tenga un error.

Además, como respaldo ante una restauración del servidor (E13), los registros
propios `SYNCED` se conservan al menos 7 días aunque su convocatoria pueda
limpiarse antes (no ocurre con 30 días, pero queda como regla mínima).

## 6. Recuperación

| Situación                                        | Comportamiento                                                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App cerrada a la fuerza o batería agotada        | Transacciones atómicas; `IN_FLIGHT` → `PENDING` al abrir                                                                                                   |
| Cambio de época del servidor (backup restaurado) | Cursores a 0, descarga completa y **reenvío** de los registros propios recientes con sus mismos UUID; el servidor los acepta o los reconoce como repetidos |
| Cierre de sesión con operaciones pendientes      | Se advierte y se intenta enviar; solo con confirmación explícita se borra la base local                                                                    |
| Cuenta desactivada                               | Las operaciones vuelven `REJECTED` (`ACCOUNT_INACTIVE`); se muestran antes de cerrar la sesión                                                             |
| Base local dañada o migración fallida            | Se intenta extraer y enviar `outbox`; luego se recrea la base y se descarga todo                                                                           |
| Teléfono nuevo o reinstalación                   | Nuevo `device_id`; descarga completa. Lo que nunca salió del teléfono anterior se pierde; por eso la app avisa de pendientes antes de cerrar sesión        |

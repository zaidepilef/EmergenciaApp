# Resolución de conflictos y tiempo

> **PROPUESTA PARA REVISIÓN.** Responde al punto 3: resolver conflictos **sin
> depender exclusivamente del reloj del dispositivo**.

## 1. El problema

El reloj de un teléfono puede estar adelantado, atrasado o cambiar mientras está
sin conexión. Si el orden de las acciones dependiera solo de esa hora, un
teléfono con la hora mal podría "ganar" siempre, o una respuesta reciente
podría quedar por debajo de una antigua.

## 2. Cuatro fuentes de orden, de más a menos confiable

| #   | Fuente                                                                                                      | Qué ordena                                                               | Depende del reloj de pared |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| 1   | **`device_seq`**: contador por dispositivo, asignado en la misma transacción que la operación               | Operaciones de un **mismo** teléfono                                     | No                         |
| 2   | **Reloj monotónico**: milisegundos desde el arranque + identificador del arranque                           | Hora real de una acción, si el teléfono no se reinició antes de enviarla | No                         |
| 3   | **Desfase medido**: el teléfono envía su hora al sincronizar; el servidor calcula la diferencia con la suya | Hora real cuando hubo reinicio                                           | Sí, pero corregido         |
| 4   | **`received_at`** del servidor                                                                              | Último recurso                                                           | No (reloj del servidor)    |

Los registros hechos por un coordinador a posteriori (`COORDINATOR_PROXY`, contacto
manual, presencia) usan la hora que el coordinador declara:
`time_confidence = HUMAN_DECLARED`.

## 3. Cálculo de `estimated_at`

Cada operación del teléfono trae `declared_at` (reloj de pared),
`declared_monotonic_ms` y `boot_session_id`. Cada lote trae además la hora,
el reloj monotónico y el arranque **al momento de enviar**.

```
si mismo boot_session_id al declarar y al enviar:
    estimated_at = server_now − (monotonic_envío − monotonic_declarado)   → MONOTONIC
si no, si hay desfase medido:
    estimated_at = declared_at + (server_now − device_now_envío)          → CLOCK_OFFSET
si no:
    estimated_at = received_at                                            → SERVER_RECEIPT
en todos los casos:
    estimated_at = mín(estimated_at, received_at)   // nada ocurre en el futuro
```

El servidor guarda siempre los tres valores: `declared_at` (lo que dijo el
teléfono), `estimated_at` (lo que usa para ordenar) y `received_at`. Q3 exige
conservar la fecha declarada y la de recepción; aquí se cumple y se agrega la
estimación.

Requisito para mobile-architect: acceso a un reloj monotónico desde el arranque
(por ejemplo, `SystemClock.elapsedRealtime` en Android y
`ProcessInfo.systemUptime` en iOS) y un identificador del arranque. Si Expo no
lo expone, se usa solo el desfase medido (fuente 3).

## 4. Detección de conflicto: `base_row_version`

El teléfono envía la versión del dato que **veía** cuando el usuario actuó
(por ejemplo, el `row_version` de su `emergency_recipient`). Al llegar:

- Si la versión actual del servidor es la misma → no hubo otra escritura → se
  aplica (`APPLIED`).
- Si es mayor → alguien escribió entre medio (otro teléfono, el coordinador) →
  se compara por tiempo con las reglas de §5.

## 5. Reglas por dato

### Dentro de un mismo teléfono

Manda **siempre `device_seq`**: la segunda acción del usuario reemplaza a la
primera, sin mirar ningún reloj.

### Entre fuentes distintas

Se compara `estimated_at` con una **ventana de ambigüedad de 60 segundos**:

| Situación                                       | Resultado                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| La operación nueva es posterior por más de 60 s | `APPLIED`: pasa a ser la vigente                                                            |
| La operación nueva es anterior por más de 60 s  | `SUPERSEDED`: queda en el historial, no cambia la vigente                                   |
| Diferencia de 60 s o menos                      | `CONFLICT`: se aplica la regla de desempate, queda en el historial y se marca para revisión |

Desempate dentro de la ventana:

| Dato                                          | Desempate                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| Disponibilidad                                | La de mayor `received_at` (la última que llegó)                           |
| Respuesta: app frente a coordinador           | **Gana la del propio brigadista (`APP`)**: es información de primera mano |
| Respuesta: dos teléfonos del mismo brigadista | La de mayor `received_at`                                                 |

Un `CONFLICT` deja `sync_operation.resolution_status = 'PENDING_REVIEW'`. El
coordinador lo ve en el panel y puede confirmarlo o corregirlo; corregir genera
**una nueva** respuesta registrada por él, nunca modifica la anterior.

### Respuestas y cierre de la convocatoria (Q3)

| `estimated_at` frente a `closed_at`     | Resultado                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| Antes del cierre, recibida después      | `APPLIED` (o `SUPERSEDED` / `CONFLICT` según §5) con `late_sync_after_close = true`     |
| Después del cierre                      | `REJECTED` con código `EMERGENCY_CLOSED`; se conserva en `sync_operation` para revisión |
| Dentro de los 60 s alrededor del cierre | `CONFLICT` con `late_sync_after_close = true`; revisión del coordinador                 |

Con `time_confidence = SERVER_RECEIPT` (sin información confiable) y recepción
posterior al cierre, se registra como `CONFLICT`: no se rechaza a ciegas.

### Datos que solo escribe el servidor

Convocatoria, avisos, convocados y perfil (salvo disponibilidad): el teléfono
no los modifica, así que no hay conflicto. Si el teléfono tiene una versión vieja,
la reemplaza en la siguiente descarga.

## 6. Rechazos

| Código             | Causa                          | Qué ve el usuario                                                                     |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------- |
| `EMERGENCY_CLOSED` | Respuesta posterior al cierre  | "La convocatoria ya estaba cerrada cuando respondiste. El coordinador fue notificado" |
| `NOT_A_RECIPIENT`  | No figura entre los convocados | "No figuras en esta convocatoria. Contacta al coordinador"                            |
| `ACCOUNT_INACTIVE` | Cuenta o perfil desactivado    | "Tu cuenta no está activa" y cierre de sesión                                         |
| `INVALID_PAYLOAD`  | Datos inválidos                | Error técnico, se reporta                                                             |

Todo rechazo queda en `sync_operation` con su payload y
`resolution_status = 'PENDING_REVIEW'` (punto 4), y en el teléfono como
`REJECTED` hasta que el usuario lo vea.

# Envío de notificaciones push (lado servidor)

> **PROPUESTA PARA APROBACIÓN.** Implementa
> [`delivery-and-ack.md`](../database/synchronization/delivery-and-ack.md)
> (database-architect). El lado del dispositivo es de mobile-architect.

## 1. Principio

El push es un **timbre**. La convocatoria, los convocados y los avisos se
confirman en la base **antes** de cualquier envío y existen aunque el envío
falle (bandeja interna). Ningún éxito del proveedor se muestra como "recibido":
eso solo lo dice un `notice_ack` enviado por el teléfono.

## 2. Proveedor: Expo Push Service

| Opción | A favor | En contra |
|---|---|---|
| **Expo Push** (`expo-server-sdk` 8.0) | Una API para Android e iOS; encaja con Expo en la app; tickets y recibos con errores claros (`DeviceNotRegistered`) | Servicio externo adicional entre el servidor y FCM/APNs; requiere `EXPO_ACCESS_TOKEN` |
| FCM + APNs directo | Sin intermediario | Dos integraciones, certificados/llaves de Apple, más código y más pruebas |

**Recomendación: Expo Push en el MVP**, con el envío detrás de una interfaz
`PushProvider` (`send`, `getReceipts`) para poder pasar a FCM/APNs directo sin
tocar la cola. La decisión final se toma con mobile-architect (D-B3).

Mensaje: título y cuerpo con el tipo de emergencia y el punto de encuentro
(para entenderla sin abrir la app), más `data: { noticeId, emergencyId, kind }`.
**Sin datos personales** en el push (pasa por terceros): ni nombres, ni RUT, ni
teléfonos. Prioridad alta y canal
Android de emergencias (definidos por ui-ux-designer y mobile-architect).

## 3. Cola en PostgreSQL

No hace falta un broker (Redis, RabbitMQ) ni una librería de colas: la tabla
`notification_delivery` **es** la cola.

1. **Transacción de activación** (o de un aviso nuevo): inserta una fila
   `QUEUED` por convocado × dispositivo no revocado con token `VALID`, con
   `next_attempt_at = now()`. Al final, `NOTIFY push_queue`.
2. **Worker** (proceso aparte, mismo código e imagen, `node dist/worker.js`):
   - Escucha `LISTEN push_queue` y, como respaldo, consulta cada 5 s.
   - Toma un lote: `SELECT … WHERE next_attempt_at <= now() AND status IN
     ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED') ORDER BY next_attempt_at LIMIT 100
     FOR UPDATE SKIP LOCKED` (índice `delivery_retry_idx`). Con `SKIP LOCKED`
     pueden correr dos workers sin enviar dos veces la misma fila.
   - Marca `SENT` + `attempts + 1` y **confirma** antes de llamar al proveedor.
     La llamada de red nunca ocurre dentro de una transacción.
   - Con el ticket: `PROVIDER_ACCEPTED`, `provider_message_id`, y
     `next_attempt_at = now() + 15 min` para pedir el recibo.
   - Con el recibo: `PROVIDER_DELIVERED`, o `FAILED` con `last_error_code`.
     `DeviceNotRegistered` → `device.push_token_status = 'INVALID'`.
3. **Errores del proveedor:** 429 o 5xx → reintento con espera exponencial
   (30 s, 1, 2, 4 min; máximo 5 intentos) y luego `FAILED`.

Si el worker se cae entre "marcar `SENT`" y la respuesta del proveedor, la fila
queda `SENT` con `next_attempt_at` pasado y se vuelve a tomar: un push puede
llegar **dos veces**, nunca ninguna. La app descarta duplicados por `noticeId`.

## 4. Re-aviso (E1)

Mientras un convocado **no** tenga `RECEIVED` en ningún dispositivo **ni**
respuesta, se reenvía el aviso a los **2, 5 y 10 minutos** de la activación
(tiempos a validar con ui-ux-designer). Antes de cada re-envío el worker
comprueba esas dos condiciones; si se cumple alguna, pone
`next_attempt_at = NULL` y no envía.

El re-aviso reutiliza la misma fila (`delivery_once_uq` es por aviso ×
convocado × dispositivo) incrementando `attempts`. Pendiente con
database-architect: si se quiere conservar el resultado de **cada** intento
(hoy solo queda el último ticket), hace falta una tabla de intentos.

## 5. Avisos de cierre y actualización

`UPDATE`, `CLOSURE` y `REOPEN` siguen el mismo flujo. El cierre no se re-avisa.
Un aviso pendiente de una convocatoria que ya se cerró se descarta si es
`ACTIVATION` o `UPDATE` (no tiene sentido sonar por algo cerrado).

## 6. Pruebas

Las 5 de `delivery-and-ack.md` §6, más, con un `PushProvider` falso:

1. La activación se confirma aunque el proveedor esté caído.
2. Dos workers en paralelo no envían la misma fila.
3. Caída del worker tras `SENT`: la fila se reenvía.
4. `DeviceNotRegistered` marca el token `INVALID` y el panel muestra
   "Falló el envío".
5. El re-aviso se detiene con un acuse `SYNC` o con una respuesta.
6. Ningún payload enviado contiene RUT, nombres ni teléfonos.

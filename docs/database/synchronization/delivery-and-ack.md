# Bandeja interna, entrega push y acuse del dispositivo

> **PROPUESTA PARA AUDITORÍA.** Responde al punto 4: comprobar que son tres
> hechos separados, registrados por actores distintos, en tablas distintas.

## 1. Cuatro hechos, cuatro tablas

| Hecho                     | Pregunta que responde                                      | Tabla                                      | Quién lo escribe                          |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| **Bandeja interna**       | ¿El brigadista **está convocado** y qué avisos tiene?      | `emergency_recipient` + `emergency_notice` | Servidor, al activar o agregar            |
| **Entrega push**          | ¿Qué hizo el **proveedor** con el aviso?                   | `notification_delivery`                    | Servidor, con respuestas de Expo/FCM/APNs |
| **Acuse del dispositivo** | ¿El **teléfono** tiene el aviso? ¿El usuario lo **abrió**? | `notice_ack`                               | Solo el teléfono (vía sincronización)     |
| **Respuesta**             | ¿Qué **decidió** el brigadista?                            | `emergency_response`                       | Teléfono o coordinador en su nombre       |

## 2. Invariantes

1. **La bandeja no depende del push.** El convocado y el aviso se crean en la
   transacción de activación aunque el brigadista no tenga dispositivo, token o
   permisos de notificación. El push es solo un timbre.
2. **La entrega push solo registra hechos del proveedor.** `delivery_status` llega
   como máximo a `PROVIDER_DELIVERED` ("entregado a FCM/APNs"). No existe en esa
   tabla ningún estado ni columna de "recibido por el teléfono" ni "abierto".
3. **El acuse solo lo escribe el teléfono.** Cada `notice_ack` está ligado a una
   `sync_operation` (FK `operation_id`) enviada por el dispositivo. El servidor
   no puede inferir un acuse a partir de un éxito del proveedor.
4. **El acuse dice cómo llegó.** `via = 'PUSH'` si llegó por la notificación;
   `via = 'SYNC'` si la app lo descargó de la bandeja (por ejemplo, con el push
   perdido). Un acuse `SYNC` es tan válido como uno `PUSH`.
5. **Acuse ≠ respuesta.** Que el teléfono tenga o abra el aviso no registra
   ninguna respuesta; la respuesta es una acción explícita del usuario.
6. **Un acuse por nivel.** U (`notice_id`, `recipient_id`, `device_id`, `level`):
   `RECEIVED` y `OPENED` como mucho una vez cada uno por dispositivo.

## 3. Cuándo se envía cada acuse (teléfono)

| Momento                                                                     | Acuse                    |
| --------------------------------------------------------------------------- | ------------------------ |
| El manejador de notificaciones de la app recibe el push con datos del aviso | `RECEIVED`, `via = PUSH` |
| La sincronización descarga un aviso que el teléfono no tenía                | `RECEIVED`, `via = SYNC` |
| El usuario abre el aviso en la app                                          | `OPENED`                 |

Si la notificación se muestra por el sistema operativo sin que la app ejecute
código (posible en iOS con la app cerrada), **no** hay acuse `RECEIVED` hasta que
la app abra o sincronice. El modelo prefiere un "no confirmado" honesto a un
"recibido" supuesto.

## 4. Lo que ve el coordinador (derivado, no guardado)

Por convocado y por aviso:

| Estado mostrado                       | Condición                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------- |
| **Respondió**                         | Existe respuesta vigente                                                   |
| **Abierto, sin respuesta**            | Hay `OPENED` en algún dispositivo y no hay respuesta                       |
| **Recibido, sin abrir**               | Hay `RECEIVED` y no `OPENED`                                               |
| **Entregado al proveedor, sin acuse** | Alguna entrega en `PROVIDER_ACCEPTED`/`PROVIDER_DELIVERED`, sin `RECEIVED` |
| **Falló el envío**                    | Todas las entregas `FAILED` o token inválido, sin acuse                    |
| **Sin dispositivo**                   | No tiene dispositivos activos con token válido                             |

Más el contacto manual (`manual_contact`) cuando exista.

## 5. Re-aviso (E1)

Se reenvía el push del aviso mientras **no** exista `RECEIVED` en ningún
dispositivo del convocado ni respuesta. Al llegar cualquiera de los dos, se
cancelan los reintentos (`next_attempt_at = NULL`). Las reglas de tiempo (por
ejemplo 2, 5 y 10 minutos) las define backend-architect con ui-ux-designer.

## 6. Pruebas obligatorias

1. Activar con un brigadista sin dispositivos: el convocado y el aviso existen y
   el teléfono los descarga al iniciar sesión (`via = SYNC`).
2. Proveedor responde éxito: el panel muestra "Entregado al proveedor, sin
   acuse", nunca "Recibido".
3. Push fallido y luego sincronización: el acuse queda `via = SYNC` y el
   re-aviso se detiene.
4. Abrir el aviso no crea respuesta.
5. Reenviar el mismo acuse no duplica (operación repetida).

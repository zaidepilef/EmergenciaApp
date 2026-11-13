# Lista de verificación para la auditoría final

> Estado: **revisión 2 lista para auditoría** (2026-11-13). Sin `schema.prisma`,
> migraciones ni SQL ejecutado.

## 1. Cambios desde la revisión 1

| #   | Cambio                                                                                                                                         | Motivo                                         | Documento                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------- |
| C1  | Retirada `emergency_attendance` y su enum                                                                                                      | P2: fuera del MVP                              | `postgresql/schema.md` §6 |
| C2  | Nueva `sync_operation_resolution` (append-only)                                                                                                | Punto 2: resoluciones como eventos             | §7                        |
| C3  | `sync_operation` pasa a append-only; se quitan sus columnas de resolución                                                                      | Punto 2                                        | §7                        |
| C4  | `emergency_response.corrects_operation_id`                                                                                                     | Una corrección es una respuesta nueva enlazada | §5                        |
| C5  | Secuencia `CACHE 1`, candado con clave fija, candado tomado primero en cada transacción                                                        | Punto 1                                        | §2, `versioning.md`       |
| C6  | `user_role` sin `row_version`; su alta o baja actualiza `app_user`                                                                             | Punto 1: borrados sin lápida                   | §3                        |
| C7  | `app_user.credential_version`; `CHECK` provisoria ⇔ vencimiento; `CHECK` activo ⇔ sin fecha de baja                                            | Punto 3                                        | §3, `security.md`         |
| C8  | `auth_session.family_id`, `scope`, `credential_version`, `revoked_reason`                                                                      | Punto 3                                        | §3                        |
| C9  | `delivery_status` sin `DEVICE_RECEIVED` ni `OPENED`; nuevo `PROVIDER_DELIVERED`; columnas del dispositivo retiradas de `notification_delivery` | Punto 4                                        | §6                        |
| C10 | `notice_ack` con `level` (`RECEIVED`/`OPENED`), `via` (`PUSH`/`SYNC`) y FK a su `sync_operation`                                               | Punto 4                                        | §6                        |
| C11 | Eliminado `emergency_recipient.first_seen_at` (era un resumen ambiguo)                                                                         | Punto 4                                        | §5                        |
| C12 | SQLite: triggers de inmutabilidad de contenido en `outbox` y registros propios; `notice_ack` local con niveles; `sync_result` local            | Puntos 2 y 4                                   | `sqlite/schema.md`        |
| C13 | `CHECK estimated_at <= received_at` en historial                                                                                               | Nada ocurre en el futuro                       | §4–5                      |
| C14 | Descarga del convocado tardío incluye su convocatoria y avisos completos                                                                       | Punto 1: versiones viejas bajo el cursor       | `versioning.md` §4        |

## 2. Verificación por punto

### Punto 1 — Orden de confirmación y descargas consistentes

- [ ] La demostración de `versioning.md` §3 se sostiene (lemas 1 y 2 y teorema).
- [ ] La secuencia es `CACHE 1`.
- [ ] Toda tabla replicada tiene `row_version NOT NULL` y el trigger.
- [ ] La descarga usa una sola instantánea `REPEATABLE READ READ ONLY`.
- [ ] El cursor es la versión de la última fila devuelta.
- [ ] El teléfono solo aplica una fila si su versión es mayor que la local.
- [ ] Convocado tardío, rol revocado y restauración de backup están cubiertos.
- [ ] Prueba de integración prevista, incluida la variante negativa.

### Punto 2 — Inmutabilidad y resoluciones como eventos

- [ ] `sync_operation`, `sync_operation_resolution` y todas las tablas de historial tienen `forbid_mutation`.
- [ ] Una sola resolución final por operación (índice único parcial).
- [ ] `CORRECTED` exige una respuesta nueva; la original no cambia.
- [ ] En SQLite, el contenido de operaciones y registros propios no puede cambiar (triggers `*_content_immutable`).

### Punto 3 — Contraseñas provisorias y sesiones

- [ ] Provisoria ⇔ vencimiento (`CHECK`).
- [ ] Restablecer y renovar usan `SELECT ... FOR UPDATE` sobre `app_user`.
- [ ] `credential_version` se incrementa al restablecer, cambiar la contraseña y desactivar.
- [ ] La sesión con provisoria es `PASSWORD_CHANGE_ONLY`.
- [ ] Reutilizar un token de renovación revoca la familia.
- [ ] Las siete pruebas de `security.md` §4 están asignadas a backend-architect.

### Punto 4 — Bandeja, entrega push y acuse

- [ ] La bandeja se crea al activar sin depender de dispositivos ni tokens.
- [ ] `notification_delivery` no tiene ningún estado ni columna del dispositivo.
- [ ] `notice_ack` solo nace de una `sync_operation` del teléfono.
- [ ] Acuse ≠ respuesta.
- [ ] El panel deriva sus estados de las tres tablas (`delivery-and-ack.md` §4).

### Revisión 1 (siguen vigentes)

- [ ] Cola persistente en la misma transacción que el dato (`offline-storage.md` §1).
- [ ] Duplicados bloqueados en teléfono, servidor, registros, acuses y entregas (§3).
- [ ] Conflictos sin depender solo del reloj (`conflict-resolution.md`).
- [ ] Rechazos conservados en ambos lados.
- [ ] Permisos separados de la condición de brigadista.
- [ ] Limpieza local protegida (tres barreras).

## 3. Riesgos conocidos y aceptados

| Riesgo                                                           | Por qué se acepta           | Mitigación                                                                       |
| ---------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| Escrituras replicadas en serie por el candado                    | Volumen bajo de una brigada | Transacciones cortas; push después del commit                                    |
| Reloj monotónico quizá no disponible en Expo                     | Depende de la plataforma    | Se usa el desfase medido; queda marcado en `time_confidence`                     |
| iOS puede mostrar una notificación sin que la app ejecute código | Restricción del sistema     | El acuse llega al abrir o sincronizar; el panel muestra "sin acuse" honestamente |
| Índices parciales quizá no soportados por la versión de Prisma   | Depende de la versión       | SQL manual en la migración                                                       |
| Teléfono perdido con operaciones nunca enviadas                  | Inevitable                  | Aviso al cerrar sesión; contacto manual del coordinador                          |

## 4. Pendiente después de la auditoría

1. Autorización expresa para traducir a `schema.prisma` y migraciones.
2. Contrato HTTP de sincronización (backend-architect + mobile-architect).
3. Valores de tiempo: re-aviso, vida del token de acceso, plazo de la provisoria.
4. Confirmar PostgreSQL 18 con devops-architect.
5. Marcar `docs/mongodb-data-model.md` como histórico.

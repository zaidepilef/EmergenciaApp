# Lista de verificación para la auditoría final

> Estado: **revisión 2.1, tras implementar** (2026-11-13). La revisión 2 está
> implementada en `backend/prisma/` y aplicada solo en la base local de Docker.
> §1–4: revisión 2 tal como se auditó. §5: revisión 2.1.

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
| Índices parciales fuera de `schema.prisma` (revisión 2.1)        | El preview generaba deriva  | Solo SQL de las migraciones; database-architect los revisa en el SQL             |
| Teléfono perdido con operaciones nunca enviadas                  | Inevitable                  | Aviso al cerrar sesión; contacto manual del coordinador                          |

## 4. Pendiente después de la auditoría

1. Autorización expresa para traducir a `schema.prisma` y migraciones.
2. Contrato HTTP de sincronización (backend-architect + mobile-architect).
3. Valores de tiempo: re-aviso, vida del token de acceso, plazo de la provisoria.
4. Confirmar PostgreSQL 18 con devops-architect.
5. ~~Marcar `docs/mongodb-data-model.md` como histórico.~~ Hecho: archivado en `docs/archive/pwa-mongodb/` (2026-11-16).

El punto 1 quedó resuelto: autorización dada y revisión 2 implementada (§5).

## 5. Revisión 2.1 — tras implementar

La auditoría de `backend/prisma/schema.prisma` y `backend/prisma/migrations/`
(2026-11-13) concluyó que la implementación es **fiel a la revisión 2**. Esta
sección registra lo verificado en la base real, los ajustes que el diseño
adopta y lo que queda pendiente. Ninguna decisión aprobada cambia.

### 5.1 Verificado en la base real

Base local de Docker, PostgreSQL 18.7, Prisma 7.10.1 (informe de
backend-architect, commit `e808262`; detalle en `backend/prisma/README.md` y
`backend/README.md`):

- [x] `prisma migrate deploy` aplica las dos migraciones sin errores
      (`20261113000000_init`, `20261113010000_row_version_positive`).
- [x] **Deriva vacía** en las dos comparaciones: migraciones contra
      `schema.prisma` (base sombra) y base aplicada contra `schema.prisma`.
- [x] **29 pruebas de integración** pasan:
  - Propiedad P de `versioning.md` §6, escenario determinista: con el candado
    no se pierde nada; sin el candado se pierde la fila esperada.
  - Estrés (8 escritores × 30 transacciones, abortos y pausas, lector en bucle
    con `REPEATABLE READ READ ONLY`): con el candado, **0 filas perdidas**; la
    variante sin candado **detecta pérdidas** (~1/3 en la primera ronda).
  - Invariantes: secuencia `CACHE 1`; trigger `set_row_version` y
    `CHECK (row_version > 0)` en las 7 tablas replicadas; `DEFAULT 0` rechazado
    sin trigger; `UPDATE`/`DELETE` rechazados en las 8 tablas append-only;
    provisoria ⇔ vencimiento; formato de RUT; una sola convocatoria `ACTIVE`;
    una sola resolución final por operación.
- [ ] Pendiente: pruebas de `security.md` §4 que dependen de los permisos del
      rol de la aplicación (script de devops-architect) y de la API.

### 5.2 Ajustes que el diseño adopta (H2–H7)

| #   | Ajuste                                                                                                                                                                             | Por qué es equivalente o mejor                                                                                                                                                       | `postgresql/schema.md` |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| H2  | Correo: índice único simple `app_user_email_key (email)` + `CHECK app_user_email_lower_chk (email IS NULL OR email = lower(email))`, en lugar de índice único sobre `lower(email)` | Con todo correo en minúsculas, único sobre `email` = único sobre `lower(email)`. Prisma lo expresa sin SQL de índice. El backend aplica `lower()` al escribir y al buscar            | §3                     |
| H3  | `device_push_token_uq` sin predicado                                                                                                                                               | Por `NULLS DISTINCT` (por defecto), varios `NULL` no chocan: equivale al parcial `WHERE push_token IS NOT NULL`                                                                      | §3                     |
| H4  | Únicos en `brigadista_profile.last_availability_change_id`, `emergency_recipient.current_response_id` y `notice_ack.operation_id` (Prisma los exige por ser relaciones 1:1)        | Son invariantes del dominio: un cambio de disponibilidad es el vigente de un solo perfil; una respuesta es la vigente de un solo convocado; una operación origina a lo sumo un acuse | §4–6                   |
| H5  | `resolution_operation_idx (operation_id)` en `sync_operation_resolution`                                                                                                           | Lista todas las resoluciones de una operación (incluidas las notas); el único parcial solo cubre las finales                                                                         | §7                     |
| H6  | `CHECK device_last_seq_chk (last_device_seq >= 0)` y `CHECK auth_session_reason_chk` con los 8 motivos de `security.md`                                                            | Cierra valores que el diseño ya suponía                                                                                                                                              | §3                     |
| H7  | `CHECK (row_version > 0)` en las 7 tablas replicadas (migración `20261113010000_row_version_positive`, ya implementada)                                                            | El `DEFAULT 0` que exige Prisma queda rechazado si falta el trigger: la escritura falla en vez de crear filas invisibles para la descarga                                            | §2–5                   |

Decisiones de implementación de backend-architect que el diseño acepta:

- [x] **Índices parciales solo en SQL manual.** Con el preview
      `partialIndexes`, PostgreSQL reescribe `IN (...)` como
      `= ANY (ARRAY[...])` y Prisma veía deriva permanente. Sin el preview,
      Prisma los ignora: los 9 parciales viven solo en las migraciones (y como
      comentario en `schema.prisma`). Un índice parcial nuevo se agrega a mano
      en una migración nueva y se revisa en el SQL.
- [x] **`updated_at` solo por trigger.** Sin `@updatedAt`: `DEFAULT now()` y
      `touch_updated_at`. Una sola fuente: el reloj del servidor de base de
      datos.

### 5.3 A verificar en cada migración nueva

- [ ] Toda tabla replicada nueva: trigger `set_row_version` + `CHECK (row_version > 0)`.
- [ ] Todo índice parcial nuevo: en el SQL de la migración, no en `schema.prisma`.
- [ ] Todo correo escrito o buscado pasa por `lower()` en el backend (H2).

### 5.4 H9 — `set_row_version` en todo `UPDATE` de `app_user` (propuesta)

**Problema.** El trigger corre en cualquier `UPDATE` de `app_user`. Cada inicio
de sesión (`last_login_at`) y cada cambio de `password_hash`,
`credential_version` o `password_expires_at`:

1. Toma el candado global `pg_advisory_xact_lock(7352001)` y serializa los
   inicios de sesión con todas las escrituras replicadas (por ejemplo, la
   brigada entera iniciando sesión justo al activar una convocatoria).
2. Genera una versión nueva, y el teléfono vuelve a descargar su usuario sin que
   haya cambiado nada de lo que guarda.
3. Abre un riesgo de **interbloqueo**: el restablecimiento de contraseña hace
   `SELECT ... FOR UPDATE` de `app_user` (`security.md` §2) y después el
   `UPDATE` pide el candado; si otra transacción ya tiene el candado y luego
   actualiza la misma fila (touch de roles), cada una espera a la otra.
   PostgreSQL lo detecta y aborta una, pero es una falla evitable.

Columnas de `app_user` que el teléfono replica (`local_user` en
`sqlite/schema.md`): `full_name`, `active` (con `deactivated_at`, atado por
`CHECK`) y la lista de roles (vía el touch de `user_role`). Ninguna otra.

**Opciones evaluadas.**

| Opción                                                                | Resultado                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `BEFORE UPDATE OF full_name, active`                               | **Descartada.** Solo mira si la columna está en el `SET`, no si cambió: dispara con `SET full_name = full_name` y no dispara con el touch de roles, que no toca esas columnas. Obligaría a un touch artificial y frágil |
| B. `WHEN` que compara solo `full_name` y `active`                     | **Insuficiente.** Compara valores reales, pero el touch de roles no cambia ninguna de las dos: el teléfono dejaría de recibir altas y bajas de roles                                                                    |
| C. B + contador `roles_revision` que el alta o baja de rol incrementa | **Recomendada.** El touch de roles pasa a ser `SET roles_revision = roles_revision + 1`, un cambio real que el `WHEN` detecta. Explícito, determinista (un contador, no una hora que pueda repetirse) y comprobable     |
| D. B + touch de roles con `SET row_version = 0` como señal            | **Descartada.** Funciona con `CHECK (row_version > 0)` como red, pero depende de un efecto lateral poco legible                                                                                                         |

**Propuesta (opción C), solo diseño, no ejecutar:**

```sql
ALTER TABLE app_user
  ADD COLUMN roles_revision integer NOT NULL DEFAULT 0
  CONSTRAINT app_user_roles_revision_chk CHECK (roles_revision >= 0);

DROP TRIGGER app_user_row_version ON app_user;
CREATE TRIGGER app_user_row_version_insert BEFORE INSERT ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_row_version();
CREATE TRIGGER app_user_row_version_update BEFORE UPDATE ON app_user
  FOR EACH ROW
  WHEN (OLD.full_name      IS DISTINCT FROM NEW.full_name
     OR OLD.active         IS DISTINCT FROM NEW.active
     OR OLD.deactivated_at IS DISTINCT FROM NEW.deactivated_at
     OR OLD.roles_revision IS DISTINCT FROM NEW.roles_revision
     OR OLD.row_version    IS DISTINCT FROM NEW.row_version)  -- nadie fija row_version a mano
  EXECUTE FUNCTION set_row_version();
-- Alta o baja de rol, en la misma transacción que user_role y audit_log:
--   UPDATE app_user SET roles_revision = roles_revision + 1 WHERE id = $1;
```

Efectos y reglas:

- Inicio de sesión y cambios de credenciales **no** toman el candado ni cambian
  `row_version`; `touch_updated_at` sigue actualizando `updated_at`.
- La demostración de `versioning.md` §3 se mantiene: solo queda fuera del
  candado una escritura que no cambia nada replicado ni la versión, así que no
  aparece ninguna versión nueva que la descarga pueda perder.
- Regla nueva: **toda columna de `app_user` que se agregue a la réplica entra en
  el `WHEN`**. La prueba de invariantes debe comprobarlo.
- La desactivación cambia `active`: sigue tomando el candado y debe tomarlo
  **primero**, antes del `SELECT ... FOR UPDATE` (orden fijo de
  `postgresql/schema.md` §8).
- Pruebas que debería agregar backend-architect: actualizar `last_login_at` no
  cambia `row_version` ni deja el candado en `pg_locks`; cambiar `full_name`,
  `active` o `roles_revision` sí lo cambia; un `UPDATE` que fija `row_version`
  a mano queda sobrescrito por el trigger.

**Requiere migración** (columna nueva y triggers reemplazados) y el campo en
`schema.prisma`. **Pendiente para backend-architect**, tras aprobación del
agente principal. Al aprobarse, database-architect actualiza
`postgresql/schema.md` §2–3, `versioning.md` y `security.md` §2 (el
restablecimiento deja de tomar el candado). Hasta entonces rige el diseño de la
revisión 2: correcto pero más costoso, con una condición para el backend: toda
transacción que actualice `app_user` (inicio de sesión, restablecimiento,
cambio de contraseña) toma `pg_advisory_xact_lock(7352001)` **antes** de
cualquier `SELECT ... FOR UPDATE` o `UPDATE` de esa tabla, como ya exige
`postgresql/schema.md` §8 para toda tabla replicada. Así no hay interbloqueo.

### 5.5 Dígito verificador del RUT

**Decisión: aceptable.** La base valida solo el formato canónico
(`app_user_rut_format_chk`, `^[1-9][0-9]{0,7}-[0-9K]$`); el dígito verificador
(módulo 11) lo valida `packages/shared/` en el backend, antes de escribir.

Motivos:

- Una sola implementación del algoritmo, común a backend, web y móvil
  (decisión de `AGENTS.md`). Repetirla en PL/pgSQL sería otra copia que puede
  divergir.
- El único escritor de `app_user` es el backend con el rol de la aplicación. El
  formato en la base ya impide RUT mal normalizados (puntos, `k` minúscula,
  ceros a la izquierda) que burlarían el `UNIQUE`.
- Un RUT con dígito incorrecto no rompe ninguna invariante de la base: es un
  dato de identidad equivocado, como un nombre mal escrito, y se corrige por la
  vía administrativa.

Condiciones:

- [ ] backend-architect: prueba que rechaza un RUT con dígito incorrecto al
      crear y al editar usuarios.
- [ ] Las cargas iniciales (semillas, importaciones) pasan por `packages/shared/`,
      nunca por SQL directo.
- [ ] Si aparece un segundo escritor (otra aplicación o carga por SQL), se
      agrega un `CHECK` con una función `IMMUTABLE` de dígito verificador en una
      migración nueva.

### 5.6 Pendiente

1. Aprobación de la propuesta H9 (§5.4) y su migración (backend-architect).
2. Pruebas de `security.md` §4 con los permisos del rol (script de devops-architect).
3. Pruebas del dígito verificador del RUT en el backend (§5.5).

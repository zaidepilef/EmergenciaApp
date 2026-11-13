# Esquema Prisma y migraciones

> **Estado:** escrito con autorización expresa del usuario (2026-11-13).
> **Aplicado solo en la base local de Docker** (PostgreSQL 18.7, autorización del
> usuario del 2026-11-13). Ningún otro entorno. Cómo levantarla: [`../README.md`](../README.md).

Diseño: [`docs/database/physical-model.md`](../../docs/database/physical-model.md)
y [`postgresql/schema.md`](../../docs/database/postgresql/schema.md), revisión 2.

## Contenido

| Archivo                                        | Qué es                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `schema.prisma`                                | 17 modelos, 20 enums, 39 FK, índices (los parciales, solo como comentario) |
| `migrations/20261113000000_init/migration.sql` | Parte 1: generada por Prisma. Parte 2: SQL manual              |
| `migrations/20261113010000_row_version_positive/migration.sql` | SQL manual: `CHECK (row_version > 0)` en las 7 tablas replicadas |
| `../prisma.config.ts`                          | Rutas y `DATABASE_URL` desde el entorno                        |

## SQL manual (parte 2 de la migración inicial)

Lo que Prisma no puede expresar:

- Restricciones `CHECK` (RUT, contraseña provisoria ⇔ vencimiento, estados, tiempos).
- Secuencia `sync_row_version_seq` con `CACHE 1` y trigger `set_row_version`
  con candado de transacción (ver `docs/database/synchronization/versioning.md`).
- Trigger `touch_updated_at` para escrituras fuera de Prisma.
- Trigger `forbid_mutation` en las 8 tablas append-only.
- Fila inicial de `sync_metadata`.

Los permisos del rol de base de datos de la aplicación quedan para un script de
devops-architect.

## Decisiones de implementación

- **Prisma 7.10.1** (última estable; 8.0 sigue en RC).
- **Índices parciales solo en SQL** (sin `previewFeatures`). Ver la sección
  siguiente.
- `row_version` tiene `@default(0)` solo para que Prisma no lo exija al insertar;
  el trigger siempre lo sobrescribe. La migración `20261113010000_row_version_positive`
  agrega `CHECK (row_version > 0)` para que una tabla replicada sin trigger falle
  al escribir en vez de guardar filas con versión 0, invisibles para la descarga
  (auditoría de database-architect, 2026-11-13).
- `updated_at` **sin `@updatedAt`**: queda `@default(now())` + trigger
  `touch_updated_at`. `@updatedAt` hacía que Prisma Client enviara la hora del
  reloj de la aplicación; así la hora es siempre la del servidor de base de datos.
  No genera deriva (`@updatedAt` no existe en el SQL).
- Los IDs que genera el teléfono (`device`, `availability_change`,
  `emergency_response`, `notice_ack`, `sync_operation`) no tienen default.

## Índices parciales

Con `previewFeatures = ["partialIndexes"]`, PostgreSQL 18 real mostró deriva en
`delivery_retry_idx` y `sync_operation_review_idx`: PostgreSQL guarda
`status IN ('QUEUED', …)` como `status = ANY (ARRAY['QUEUED'::delivery_status, …])`
y Prisma compara el texto, así que `migrate diff` proponía borrarlos y recrearlos
en cada migración. Por indicación de la auditoría de database-architect se
quitaron los 9 `where: raw(...)` del schema y el preview; cada índice quedó
como comentario en su modelo. Sin el preview, Prisma 7.10.1 **ignora** los
índices parciales de la base (no los borra ni los recrea): las dos
comparaciones de abajo salen vacías.

Consecuencias:

- Los índices parciales existen solo en el SQL de las migraciones (parte 1 de la
  migración inicial, que se generó cuando el preview estaba activo). Uno nuevo se
  agrega a mano en una migración nueva.
- `npm run prisma:diff` (`--from-empty`) ya no los emite: la parte 1 de la
  migración inicial ya no es idéntica a esa salida; la diferencia son
  exactamente esos 9 índices.

## Verificación hecha

Sin conexión (antes de esta etapa):

1. `prisma validate`: válido.
2. La parte 1 era idéntica a `prisma migrate diff --from-empty --to-schema`
   (con el preview activo).
3. Script que comprueba que cada columna usada en el SQL manual existe en su
   tabla y que toda tabla con `row_version` tiene su trigger.

Contra PostgreSQL 18.7 local (2026-11-13):

4. `prisma migrate deploy`: las 2 migraciones se aplican sin errores.
5. `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma`
   (base sombra): vacío (`npm run db:drift`, código de salida 0).
6. `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`: vacío.
7. `npm run test:integration`: 29 pruebas, todas pasan (propiedad P de
   `versioning.md` §6 con su variante negativa, secuencia `CACHE 1`, triggers,
   append-only y CHECK clave). Detalle en [`../README.md`](../README.md).

**Pendiente:** pruebas de `security.md` que dependen de los permisos del rol de
la aplicación (script de devops-architect) y de la API.

## Comandos

```bash
npm run prisma:validate
npm run prisma:diff   # SQL desde cero, sin conectarse a una base (sin índices parciales)
npm run db:drift      # migraciones vs schema, con base sombra local
```

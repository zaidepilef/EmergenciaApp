# Esquema Prisma y migraciones

> **Estado:** escrito con autorización expresa del usuario (2026-11-13).
> **Todavía no se ejecutó contra ninguna base.** Aplicarlo (`prisma migrate deploy`
> o `migrate dev`) requiere otra autorización.

Diseño: [`docs/database/physical-model.md`](../../docs/database/physical-model.md)
y [`postgresql/schema.md`](../../docs/database/postgresql/schema.md), revisión 2.

## Contenido

| Archivo                                        | Qué es                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `schema.prisma`                                | 17 modelos, 20 enums, 39 FK, índices (incluidos los parciales) |
| `migrations/20261113000000_init/migration.sql` | Parte 1: generada por Prisma. Parte 2: SQL manual              |
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
- **`previewFeatures = ["partialIndexes"]`**: los índices parciales están en el
  schema para que Prisma Migrate no intente borrarlos en migraciones futuras.
- `row_version` tiene `@default(0)` solo para que Prisma no lo exija al insertar;
  el trigger siempre lo sobrescribe.
- Los IDs que genera el teléfono (`device`, `availability_change`,
  `emergency_response`, `notice_ack`, `sync_operation`) no tienen default.

## Verificación hecha (sin conexión)

1. `prisma validate`: válido.
2. La parte 1 es idéntica a `prisma migrate diff --from-empty --to-schema`.
3. Script que comprueba que cada columna usada en el SQL manual existe en su
   tabla y que toda tabla con `row_version` tiene su trigger.

**Pendiente:** aplicar en PostgreSQL 18 (Docker local) y correr
`prisma migrate diff --from-migrations` con base sombra para confirmar que no hay
deriva, más las pruebas de `versioning.md` §6 y `security.md`.

## Comandos

```bash
npm run prisma:validate
npm run prisma:diff   # SQL desde cero, sin conectarse a una base
```

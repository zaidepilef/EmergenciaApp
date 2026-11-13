# Entorno local y roles de PostgreSQL

> **Estado (2026-11-13):** el entorno local existe (lo preparó backend-architect,
> commit `e808262`). El script de roles [`deploy/postgres/roles.sql`](../../deploy/postgres/roles.sql)
> está **escrito y probado solo en bases locales desechables**. No se aplicó en
> `emergencia_dev` ni en ningún servidor. No hay infraestructura de staging ni de
> producción.

## 1. Entorno local (revisión de devops-architect)

Servicio `postgres` de [`compose.yaml`](../../compose.yaml); guía de uso en
[`backend/README.md`](../../backend/README.md).

| Aspecto | Estado | Comentario |
|---|---|---|
| Imagen | `postgres:18.7` exacta | Bien. En producción fijar además el digest (`@sha256:…`) |
| Puerto | `127.0.0.1:5433` | Bien: no se expone a la red |
| Volumen | `postgres_data` nombrado en `/var/lib/postgresql` | Bien para PostgreSQL 18 (datos en `/var/lib/postgresql/18`) |
| Credenciales | `emergencia_dev` / `dev_only_local_password`, sobrescribibles por variable | Solo desarrollo; no son secretos. El usuario es **superusuario** |
| Healthcheck | `pg_isready` por socket | Ver hallazgo H-1 |
| Init | `backend/docker/postgres-init/01-create-databases.sql` | Solo corre al crear el volumen. LF garantizado por `.gitattributes` |
| Rutas | Relativas (`./backend/...`, `../compose.yaml`) | Portables a Linux/macOS |
| Mongo (`mongo`) | Legado, sin autenticación, en `127.0.0.1` | Aceptable en local; se retira con la arquitectura anterior |

### Hallazgos

| ID | Severidad | Hallazgo | Acción |
|---|---|---|---|
| H-1 | Baja | Durante la inicialización del volumen, el entrypoint levanta un servidor temporal solo por socket: `pg_isready` sin `-h` puede dar "healthy" antes de que `01-create-databases.sql` termine, y `docker compose up --wait` volvería antes de que existan `emergencia_test`/`emergencia_shadow`. Solo afecta al primer arranque | Derivado a backend-architect: usar `pg_isready -h 127.0.0.1 …`. No se cambió para no forzar la recreación del contenedor en uso |
| H-2 | Media (producción) | La app y Prisma usan el mismo rol, superusuario y dueño de las tablas: puede desactivar triggers (`ALTER TABLE … DISABLE TRIGGER`, `session_replication_role`) y saltarse append-only | Resuelto con `deploy/postgres/roles.sql` (§2). En local se mantiene el superusuario para pruebas y `migrate reset` |
| H-3 | Baja | Sin `.gitattributes`: con `core.autocrlf=false` en Windows, un `.sh` o `.sql` de init podía quedar con CRLF y fallar en el contenedor | Corregido: `.gitattributes` fuerza LF en `*.sh`, `*.sql`, `Dockerfile`, `*.conf`, `Caddyfile` |
| H-4 | Informativa | La migración inicial trae `CREATE SCHEMA IF NOT EXISTS "public"` (generado por Prisma), que exige `CREATE` sobre la base | El script otorga `CREATE` en la base al migrador. Sin cambios para backend-architect |
| H-5 | Informativa | Los valores por defecto de contraseña (`${POSTGRES_PASSWORD:-…}`) son correctos en local, pero en producción las variables deben ser obligatorias (`${VAR:?}`) | Pendiente para el Compose de producción (§4) |

## 2. Roles y permisos

Requisito de database-architect ([`schema.md`](../database/postgresql/schema.md) §2):
sin `DELETE` salvo en `user_role`, sin `UPDATE` en las tablas append-only, como
segunda barrera además de los triggers `forbid_mutation`.

| Rol | Variable del nombre | Atributos | Qué puede hacer |
|---|---|---|---|
| Administrador | (el superusuario de la instancia) | Superusuario o `CREATEROLE` | Ejecuta `roles.sql`, backups y restauraciones. No lo usa la aplicación |
| Migrador | `PG_MIGRATOR_ROLE` (`emergencia_migrator`) | `LOGIN`, sin superusuario ni `CREATEDB`/`CREATEROLE` | Dueño de todos los objetos del esquema; `CONNECT, CREATE` en la base; `USAGE, CREATE` en el esquema. Ejecuta `prisma migrate deploy` |
| Aplicación | `PG_APP_ROLE` (`emergencia_app`) | `LOGIN`, `NOINHERIT`, sin atributos de administrador, no es miembro del migrador | Solo DML permitido (tabla siguiente). Sin DDL, `TRUNCATE`, `TRIGGER`, `REFERENCES` ni propiedad |

Permisos de la aplicación:

| Objeto | Permisos |
|---|---|
| Base | `CONNECT` (se revoca todo a `PUBLIC`, incluido `TEMPORARY`) |
| Esquema `public` | `USAGE` (sin `CREATE`) |
| Tablas append-only: `availability_change`, `emergency_notice`, `emergency_response`, `notice_ack`, `manual_contact`, `sync_operation`, `sync_operation_resolution`, `audit_log` | `SELECT, INSERT` |
| `user_role` | `SELECT, INSERT, UPDATE, DELETE` |
| Resto de tablas (`app_user`, `emergency`, `device`, …) | `SELECT, INSERT, UPDATE`. El borrado de un borrador de `emergency` es lógico (`UPDATE deleted_at`) |
| `_prisma_migrations` | Ninguno |
| Secuencias (`sync_row_version_seq`) | `USAGE`: `nextval`/`currval`, sin `setval` |
| Funciones del esquema | `EXECUTE` (se revoca a `PUBLIC`) |

Detalles del script:

- **Idempotente** y en **una transacción**: si algo falla, no queda nada a medias.
  Termina con una verificación de catálogo que aborta si la app tiene atributos
  de administrador, `CREATE` en el esquema, `UPDATE`/`DELETE` en append-only,
  `DELETE` fuera de `user_role`, `TRUNCATE`/`TRIGGER`, acceso a
  `_prisma_migrations`, `setval`, o si hay objetos que no son del migrador.
- **Traspasa la propiedad** al migrador de todo objeto del esquema que tenga
  otro dueño (tablas, secuencias, funciones, tipos). Sirve para bases migradas
  antes con el superusuario.
- Es append-only cualquier tabla de la lista **o** con un trigger que llame a
  `forbid_mutation()`: una tabla append-only nueva queda protegida aunque se
  olvide en la lista.
- **Privilegios por defecto** (`ALTER DEFAULT PRIVILEGES FOR ROLE <migrador>`):
  una tabla nueva da a la app solo `SELECT, INSERT`; `UPDATE`/`DELETE` llegan
  al re-ejecutar el script (falla cerrada). Secuencias nuevas: `USAGE`.
  Funciones nuevas: sin `EXECUTE` para `PUBLIC`, con `EXECUTE` para la app.
- **Contraseñas** solo por variable de entorno (`PG_MIGRATOR_PASSWORD`,
  `PG_APP_PASSWORD`), leídas con `\getenv`; nunca en el repositorio ni en la
  línea de comandos. Si faltan, no se cambia la contraseña existente (permite
  re-ejecutar sin conocerla). La sesión pone `log_statement = 'none'` para que
  no queden en el log del servidor (exige superusuario; si no, sigue con aviso).
- Requiere psql 15+ (`\getenv`). Se ejecuta con el psql de la imagen
  `postgres:18.7`, así no hace falta instalar nada en el equipo.

`set_row_version` no es `SECURITY DEFINER`: corre con los permisos de la app.
Basta `USAGE` en la secuencia; `pg_advisory_xact_lock` y `uuidv7` son funciones
de `pg_catalog` ejecutables por todos. Los triggers no exigen `EXECUTE` al
dispararse.

## 3. Cómo se aplica en cada entorno

Orden en todo entorno con roles separados:
**backup → `roles.sql` → `prisma migrate deploy` (como migrador) → `roles.sql` → nueva versión de la app**.
La primera ejecución crea los roles y le da `CREATE` al migrador; la segunda
otorga los permisos sobre las tablas nuevas.

### Local

La base local sigue usando el superusuario `emergencia_dev` (pruebas,
`migrate reset`, la prueba negativa que reemplaza `set_row_version`). Aplicar
`roles.sql` en `emergencia_dev` es **opcional** y no afecta a `emergencia_test`
ni a las pruebas. Ejemplo (Git Bash, Linux o macOS), con los nombres por defecto
y contraseñas locales elegidas por quien lo ejecuta:

```bash
export PG_MIGRATOR_PASSWORD='<local>' PG_APP_PASSWORD='<local>'
docker compose exec -T -e PG_MIGRATOR_PASSWORD -e PG_APP_PASSWORD postgres \
  psql -X -v ON_ERROR_STOP=1 -U emergencia_dev -d <base> -f - < deploy/postgres/roles.sql
```

Después, `DATABASE_URL` del backend apuntaría al migrador para migrar y a la app
para ejecutar (ver pendientes: hoy el backend usa una sola URL).

`emergencia_test` **no** debe usar el script de forma permanente: el
`global-setup` de las pruebas hace `DROP SCHEMA public CASCADE` y la re-migra
como superusuario en cada corrida.

### Staging / producción (propuesta, no creada)

- El script se ejecuta desde un **job de migración** (contenedor efímero con
  `postgres:18.7` + psql, o el contenedor de migración del backend) dentro de la
  red interna de Compose, nunca exponiendo PostgreSQL.
- Credenciales: `POSTGRES_PASSWORD` (administrador), `PG_MIGRATOR_PASSWORD`,
  `PG_APP_PASSWORD` en el `.env` del servidor (permisos `600`) o en el gestor de
  secretos del CI. Solo se documentan los nombres.
- El contenedor de la API recibe **solo** la URL del rol de la aplicación; el job
  de migración recibe **solo** la del migrador. El administrador no sale del
  servidor.
- Tras restaurar un backup: `roles.sql` de nuevo (los roles son de la instancia,
  no del dump) y `UPDATE sync_metadata …` según `schema.md`.

## 4. Pendientes para producción (sin crear infraestructura)

| # | Pendiente | Dueño |
|---|---|---|
| P-1 | Dos URLs en el backend: `DATABASE_URL` (app, en ejecución) y una URL de migración (migrador, para `prisma migrate deploy`), en `.env.example` y en la configuración | backend-architect |
| P-2 | Prueba de integración que corra como rol de la app (la verificación de §5 automatizada) | backend-architect |
| P-3 | Rol de retención/purga si la política de database-architect exige borrar `auth_session`, `notification_delivery` u otras (la app no tiene `DELETE`) | database-architect define, devops implementa |
| P-4 | Rol de solo lectura para backups (`pg_dump`) y monitoreo, en lugar del superusuario | devops-architect |
| P-5 | Compose de producción en `deploy/`: PostgreSQL sin `ports`, variables obligatorias (`${VAR:?}`), imagen con digest, red interna, rotación de logs | devops-architect |
| P-6 | `pg_hba.conf` de producción: `scram-sha-256`, solo red interna, sin `trust` | devops-architect |
| P-7 | Job de CI/CD que ejecute backup → `roles.sql` → migrate → `roles.sql`, con aprobación manual | devops-architect |
| P-8 | `pg_isready -h 127.0.0.1` en el healthcheck local (H-1) | backend-architect |

## 5. Cómo se probó (2026-11-13)

Solo en el contenedor local `brigada-emergencias-postgres-1`, en dos bases
desechables (`emergencia_rolescheck_a`, `emergencia_rolescheck_b`) y con roles
de prueba (`emergencia_rc_migrator`, `emergencia_rc_app`) y contraseñas
aleatorias de la sesión. Al final se borraron bases y roles. `emergencia_dev`,
`emergencia_test` y `emergencia_shadow` no se tocaron.

- **Caso A** (base migrada por el superusuario): `roles.sql` traspasó la
  propiedad al migrador; segunda ejecución idempotente; `prisma migrate deploy`
  como migrador por TCP con contraseña, sin pendientes.
- **Caso B** (flujo previsto): `roles.sql` → `prisma migrate deploy` como
  migrador → `roles.sql`. La app se conectó por TCP con contraseña.
- **Como rol de la app**, en ambos casos:
  - Funcionan: `INSERT`/`UPDATE` de `app_user` con `row_version` 1 → 2 (es decir,
    `nextval` y `pg_advisory_xact_lock` dentro de `set_row_version`), `INSERT` +
    `DELETE` en `user_role`, `INSERT` de `emergency` y borrado lógico, `INSERT`
    en `audit_log`, `nextval` directo.
  - Rechazados con `42501` (permiso, antes de llegar al trigger): `UPDATE` y
    `DELETE` en las 8 tablas append-only; `DELETE` en `emergency`, `app_user`,
    `device`; `TRUNCATE`; `ALTER TABLE … DISABLE TRIGGER` (uno y `ALL`);
    `SET session_replication_role = replica`; `DROP`/`CREATE TRIGGER`;
    `CREATE OR REPLACE FUNCTION forbid_mutation`; `CREATE TABLE`; `DROP TABLE`;
    `ALTER TABLE … ADD COLUMN`; `setval`; lectura y borrado de `_prisma_migrations`.
- **Privilegios por defecto:** una tabla nueva creada por el migrador dio a la
  app `SELECT, INSERT` sin `UPDATE`; tras re-ejecutar el script, la tabla
  mutable recibió `UPDATE` y la que tiene trigger `forbid_mutation` siguió sin él.
- `npm run test:integration` del backend: 29/29 después de las pruebas.

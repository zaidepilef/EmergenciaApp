# Backend — desarrollo local

> **Estado:** solo existen el esquema Prisma, las migraciones y las pruebas de
> integración de la base. La API todavía no está implementada.

Todo lo de esta guía es **local**: PostgreSQL en Docker ligado a `127.0.0.1`,
con credenciales de desarrollo que no son secretos. Producción, VPS y secretos
reales son de devops-architect.

## Requisitos

- Docker con Docker Compose v2.
- Node.js 24 LTS (`.nvmrc`; las pruebas también corren con Node 22.12+).
- `npm ci` dentro de `backend/`.

## Base local

Servicio `postgres` de [`compose.yaml`](../compose.yaml) (raíz del repositorio):

| Dato           | Valor                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Imagen         | `postgres:18.7` (PostgreSQL 18: `uuidv7()` nativo)                       |
| Puerto         | `127.0.0.1:5433` → 5432 del contenedor (no choca con un PostgreSQL local) |
| Usuario / clave | `emergencia_dev` / `dev_only_local_password` (sobrescribibles con `POSTGRES_USER`, `POSTGRES_PASSWORD`) |
| Volumen        | `postgres_data` (nombrado)                                               |
| Healthcheck    | `pg_isready`                                                             |

Bases de la instancia (las dos últimas las crea
[`docker/postgres-init/01-create-databases.sql`](docker/postgres-init/01-create-databases.sql)
la primera vez que se inicializa el volumen):

| Base                | Uso                                                                      |
| ------------------- | ------------------------------------------------------------------------ |
| `emergencia_dev`    | Desarrollo (`DATABASE_URL`)                                              |
| `emergencia_shadow` | Base sombra de Prisma Migrate (`SHADOW_DATABASE_URL`)                    |
| `emergencia_test`   | Pruebas de integración (`TEST_DATABASE_URL`); se **borra** en cada corrida |

El servicio `mongo` del mismo archivo pertenece a la arquitectura anterior y no
se usa aquí.

## Primeros pasos

```bash
cd backend
cp .env.example .env     # .env no se versiona; los valores ya apuntan a la base local
npm ci
npm run db:up            # levanta postgres y espera a que esté healthy
npm run db:migrate       # prisma migrate deploy sobre emergencia_dev
npm run db:drift         # migraciones vs schema.prisma: debe decir "empty migration"
npm run test:integration
```

`prisma.config.ts` carga `backend/.env` si existe (Prisma 7 no lo hace solo); una
variable ya definida en el entorno tiene prioridad sobre el archivo. Prisma CLI
usa `MIGRATION_DATABASE_URL` si está definida (rol migrador) y si no
`DATABASE_URL`; la API usará solo `DATABASE_URL`. En local basta `DATABASE_URL`.

## Scripts

| Script                     | Qué hace                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run db:up`            | `docker compose up -d --wait postgres`                                                       |
| `npm run db:stop`          | Detiene el contenedor (conserva los datos)                                                    |
| `npm run db:migrate`       | `prisma migrate deploy` sobre `DATABASE_URL`                                                 |
| `npm run db:status`        | `prisma migrate status`                                                                      |
| `npm run db:drift`         | `prisma migrate diff --from-migrations … --to-schema … --exit-code` (usa la base sombra). Sale 0 si no hay deriva, 2 si la hay |
| `npm run db:reset`         | `prisma migrate reset --force`: borra `emergencia_dev` y la re-migra                         |
| `npm run test:integration` | Vacía `emergencia_test`, le aplica las migraciones y corre `test/integration/`               |
| `npm run prisma:validate`  | Valida el schema sin conectarse                                                              |

## Pruebas de integración

En [`test/integration/`](test/integration/), con Vitest y `pg`, en serie:

- **Propiedad P** (`docs/database/synchronization/versioning.md` §6),
  `row-version-property-p.test.ts`:
  - Escenario determinista del §1 (A toma versión, B toma una mayor y confirma,
    el lector avanza el cursor, A confirma). Con el candado B espera a A y nada
    se pierde; **sin** el candado la fila de A se pierde.
  - Estrés: 8 escritores × 30 transacciones de 1–3 filas, pausas aleatorias antes
    del commit y 20 % de abortos, con un lector que descarga en bucle según §4
    (transacción `REPEATABLE READ READ ONLY`, cursor = última fila devuelta).
    Con el candado: cero filas confirmadas perdidas.
  - Variante negativa de estrés: reemplaza temporalmente `set_row_version` por
    una versión sin `pg_advisory_xact_lock` y exige que se pierdan filas. Es **no
    determinista** (depende del entrelazado real); se repite hasta 5 rondas. En
    las corridas hechas perdió ~1/3 de las filas ya en la primera ronda. La
    función original se restaura siempre y se verifica que vuelve a tener el
    candado.
- **Invariantes del esquema**, `schema-invariants.test.ts`: secuencia con
  `CACHE 1`; toda tabla con `row_version` tiene el trigger `BEFORE INSERT OR
  UPDATE` y `CHECK (row_version > 0)`; sin trigger el `DEFAULT 0` es rechazado;
  `UPDATE`/`DELETE` rechazados en las 8 tablas append-only; contraseña provisoria ⇔
  vencimiento; formato de RUT; una sola convocatoria `ACTIVE`; una sola
  resolución final por operación.
- **Permisos del rol de la aplicación** (P-2 de
  [`docs/devops/local-environment.md`](../docs/devops/local-environment.md)),
  `app-role-permissions.test.ts`: aplica `deploy/postgres/roles.sql` a
  `emergencia_test` con el psql del contenedor (`docker compose exec`), con roles
  `emergencia_test_migrator`/`emergencia_test_app` y contraseñas aleatorias.
  `prisma migrate deploy` como migrador vía `MIGRATION_DATABASE_URL` sin
  pendientes; como app: flujo completo y `row_version` funcionan, `DELETE` solo
  en `user_role`, y `42501` en `UPDATE`/`DELETE` de las 8 append-only, `TRUNCATE`,
  `DISABLE TRIGGER`, `session_replication_role`, DDL, `setval`, tablas temporales
  y `_prisma_migrations`. Requiere el contenedor corriendo (`npm run db:up`).

Salvaguarda: las pruebas se niegan a correr si `TEST_DATABASE_URL` no apunta a
`localhost`/`127.0.0.1` y a una base cuyo nombre termine en `_test`. Cada prueba
de invariantes corre dentro de una transacción que se revierte.

## Resetear la base local

```bash
npm run db:reset                                   # solo emergencia_dev: borra y re-migra
# Desde cero (borra el volumen; se vuelven a crear las 3 bases):
docker compose -f ../compose.yaml rm -sf postgres
docker volume rm brigada-emergencias_postgres_data
npm run db:up && npm run db:migrate
```

`emergencia_test` no necesita reseteo manual: cada `npm run test:integration` la
vacía y la re-migra.

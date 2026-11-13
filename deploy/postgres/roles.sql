-- =============================================================================
-- EmergenciaApp — roles y permisos de PostgreSQL (dueño: devops-architect)
-- =============================================================================
--
-- Separa dos roles:
--   * migrador  (PG_MIGRATOR_ROLE): dueño del esquema de la aplicación. Ejecuta
--     `prisma migrate deploy`. No es superusuario.
--   * aplicación (PG_APP_ROLE): el backend en ejecución. Solo DML permitido:
--       - SELECT e INSERT en todas las tablas de la aplicación.
--       - UPDATE en todas salvo las append-only.
--       - DELETE solo en user_role.
--       - Sin TRUNCATE, REFERENCES, TRIGGER, DDL ni propiedad de objetos, por lo
--         que no puede desactivar triggers (ALTER TABLE ... DISABLE TRIGGER
--         exige ser dueño) ni usar session_replication_role (exige superusuario).
--       - USAGE en las secuencias (nextval/currval, sin setval) y EXECUTE en las
--         funciones del esquema.
--     Sin acceso a _prisma_migrations.
--
-- Referencia: docs/database/postgresql/schema.md §2 y docs/devops/local-environment.md.
--
-- Uso (lo ejecuta un rol administrador: superusuario o CREATEROLE + dueño
-- actual de los objetos; conectado a la base de destino):
--
--   PG_MIGRATOR_ROLE=emergencia_migrator PG_MIGRATOR_PASSWORD=... \
--   PG_APP_ROLE=emergencia_app           PG_APP_PASSWORD=...      \
--   psql -v ON_ERROR_STOP=1 -d <base> -f deploy/postgres/roles.sql
--
-- Variables (de entorno o con -v; el entorno tiene prioridad):
--   PG_MIGRATOR_ROLE      nombre del rol migrador   (por defecto emergencia_migrator)
--   PG_APP_ROLE           nombre del rol de la app  (por defecto emergencia_app)
--   PG_APP_SCHEMA         esquema de la aplicación  (por defecto public)
--   PG_MIGRATOR_PASSWORD  si falta, no se cambia la contraseña existente
--   PG_APP_PASSWORD       si falta, no se cambia la contraseña existente
--
-- Idempotente: se ejecuta tras CADA `prisma migrate deploy`. Las tablas nuevas
-- reciben de inmediato solo SELECT/INSERT (privilegios por defecto); UPDATE y
-- DELETE se otorgan recién al re-ejecutar este script (falla cerrada).
-- Todo corre en una transacción: si algo falla, no se aplica nada.
-- Requiere psql 15+ (\getenv). Probado con PostgreSQL/psql 18.7.
-- =============================================================================

\set ON_ERROR_STOP on

\getenv migrator_role PG_MIGRATOR_ROLE
\getenv app_role PG_APP_ROLE
\getenv app_schema PG_APP_SCHEMA
\getenv migrator_password PG_MIGRATOR_PASSWORD
\getenv app_password PG_APP_PASSWORD

\if :{?migrator_role}
\else
\set migrator_role emergencia_migrator
\endif
\if :{?app_role}
\else
\set app_role emergencia_app
\endif
\if :{?app_schema}
\else
\set app_schema public
\endif

-- Que las contraseñas no queden en el log del servidor si log_statement está
-- activo. Exige superusuario; si el administrador no lo es, se omite con aviso.
\set ON_ERROR_STOP off
SET log_statement = 'none';
\set ON_ERROR_STOP on

BEGIN;

-- Parámetros visibles para los bloques DO (psql no interpola dentro de $$).
SET LOCAL emergencia.migrator_role = :'migrator_role';
SET LOCAL emergencia.app_role = :'app_role';
SET LOCAL emergencia.app_schema = :'app_schema';

-- Tablas append-only (trigger forbid_mutation). Además de esta lista, se trata
-- como append-only cualquier tabla del esquema que tenga un trigger que llame a
-- forbid_mutation(), para que una tabla nueva quede protegida aunque se olvide
-- agregarla aquí.
SET LOCAL emergencia.append_only = 'availability_change,emergency_notice,emergency_response,notice_ack,manual_contact,sync_operation,sync_operation_resolution,audit_log';
-- Únicas tablas con DELETE para la aplicación.
SET LOCAL emergencia.delete_allowed = 'user_role';

-- ─── 0. Validaciones ─────────────────────────────────────────────────────────
DO $$
DECLARE
  m text := current_setting('emergencia.migrator_role');
  a text := current_setting('emergencia.app_role');
  s text := current_setting('emergencia.app_schema');
BEGIN
  IF m = '' OR a = '' OR m = a THEN
    RAISE EXCEPTION 'Los roles migrador (%) y aplicación (%) deben existir como nombres distintos', m, a;
  END IF;
  IF m = current_user OR a = current_user THEN
    RAISE EXCEPTION 'El administrador (%) no puede ser el rol migrador ni el de la aplicación', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RAISE EXCEPTION 'No existe el esquema %', s;
  END IF;
END $$;

-- ─── 1. Roles ────────────────────────────────────────────────────────────────
SELECT format('CREATE ROLE %I', r)
FROM unnest(ARRAY[:'migrator_role', :'app_role']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec

SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', :'migrator_role') \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', :'app_role') \gexec

\if :{?migrator_password}
SELECT format('ALTER ROLE %I PASSWORD %L', :'migrator_role', :'migrator_password') \gexec
\else
\echo 'Aviso: PG_MIGRATOR_PASSWORD no definida; no se cambia la contraseña del migrador.'
\endif
\if :{?app_password}
SELECT format('ALTER ROLE %I PASSWORD %L', :'app_role', :'app_password') \gexec
\else
\echo 'Aviso: PG_APP_PASSWORD no definida; no se cambia la contraseña de la aplicación.'
\endif

-- Ninguno de los dos puede heredar ni asumir al otro.
SELECT format('REVOKE %I FROM %I', g.rolname, mbr.rolname)
FROM pg_auth_members am
JOIN pg_roles g   ON g.oid = am.roleid
JOIN pg_roles mbr ON mbr.oid = am.member
WHERE (g.rolname, mbr.rolname) IN ((:'migrator_role', :'app_role'), (:'app_role', :'migrator_role')) \gexec

-- ─── 2. Base de datos ────────────────────────────────────────────────────────
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', current_database(), :'app_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role') \gexec
-- CREATE en la base: la migración inicial de Prisma trae
-- `CREATE SCHEMA IF NOT EXISTS "public"`, que exige CREATE aunque el esquema exista.
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'migrator_role') \gexec

-- ─── 3. Esquema ──────────────────────────────────────────────────────────────
SELECT format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', :'app_schema') \gexec
SELECT format('REVOKE ALL ON SCHEMA %I FROM %I', :'app_schema', :'app_role') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', :'app_schema', :'migrator_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'app_schema', :'app_role') \gexec

-- ─── 4. Propiedad: todo objeto del esquema pasa al migrador ─────────────────
-- Cubre bases migradas antes con otro rol (p. ej. el superusuario local).
-- Las secuencias ligadas a una columna cambian de dueño con su tabla.
SELECT format('ALTER %s %I.%I OWNER TO %I',
         CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'TABLE'
                        WHEN 'v' THEN 'VIEW'  WHEN 'm' THEN 'MATERIALIZED VIEW'
                        WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' END,
         n.nspname, c.relname, :'migrator_role')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'app_schema'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = :'migrator_role')
  AND NOT (c.relkind = 'S' AND EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')))
ORDER BY c.relkind DESC, c.relname \gexec

SELECT format('ALTER %s %s OWNER TO %I',
         CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END,
         p.oid::regprocedure, :'migrator_role')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = :'app_schema'
  AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = :'migrator_role') \gexec

-- Enums, dominios y tipos compuestos independientes (no los tipos de fila de
-- las tablas ni los arreglos, que siguen a su tipo base).
SELECT format('ALTER %s %I.%I OWNER TO %I',
         CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END,
         n.nspname, t.typname, :'migrator_role')
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = :'app_schema'
  AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname = :'migrator_role')
  AND (t.typtype IN ('e', 'd', 'r')
       OR (t.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')) \gexec

-- ─── 5. Privilegios sobre los objetos existentes ─────────────────────────────
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC, %I', :'app_schema', :'app_role') \gexec
SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, %I', :'app_schema', :'app_role') \gexec
SELECT format('REVOKE ALL ON ALL ROUTINES IN SCHEMA %I FROM PUBLIC, %I', :'app_schema', :'app_role') \gexec

-- Tablas de la aplicación = todas las del esquema salvo _prisma_migrations.
CREATE TEMP TABLE _app_tables ON COMMIT DROP AS
SELECT c.oid,
       c.relname,
       (c.relname = ANY (string_to_array(current_setting('emergencia.append_only'), ','))
        OR EXISTS (SELECT 1 FROM pg_trigger tg
                   JOIN pg_proc fp ON fp.oid = tg.tgfoid
                   WHERE tg.tgrelid = c.oid AND fp.proname = 'forbid_mutation')) AS append_only,
       c.relname = ANY (string_to_array(current_setting('emergencia.delete_allowed'), ',')) AS delete_allowed
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'app_schema'
  AND c.relkind IN ('r', 'p')
  AND c.relname <> '_prisma_migrations';

SELECT format('GRANT SELECT, INSERT%s%s ON TABLE %I.%I TO %I',
         CASE WHEN NOT append_only THEN ', UPDATE' ELSE '' END,
         CASE WHEN delete_allowed AND NOT append_only THEN ', DELETE' ELSE '' END,
         :'app_schema', relname, :'app_role')
FROM _app_tables ORDER BY relname \gexec

-- USAGE = nextval/currval (lo que necesita set_row_version). Sin UPDATE: no setval.
SELECT format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO %I', :'app_schema', :'app_role') \gexec
-- Los triggers no exigen EXECUTE al dispararse; se otorga para funciones que la
-- aplicación llame directamente. pg_advisory_xact_lock y uuidv7 son de pg_catalog.
SELECT format('GRANT EXECUTE ON ALL ROUTINES IN SCHEMA %I TO %I', :'app_schema', :'app_role') \gexec

-- ─── 6. Privilegios por defecto para objetos que cree el migrador ───────────
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT ON TABLES TO %I',
         :'migrator_role', :'app_schema', :'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE ON SEQUENCES TO %I',
         :'migrator_role', :'app_schema', :'app_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
         :'migrator_role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I',
         :'migrator_role', :'app_schema', :'app_role') \gexec

-- ─── 7. Verificación: si algo no cumple, se revierte todo ───────────────────
DO $$
DECLARE
  m   text := current_setting('emergencia.migrator_role');
  a   text := current_setting('emergencia.app_role');
  s   text := current_setting('emergencia.app_schema');
  bad text[] := '{}';
  r   record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = a
             AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    bad := bad || 'la aplicación tiene atributos de administrador'::text;
  END IF;
  IF pg_has_role(a, m, 'USAGE') OR pg_has_role(a, m, 'SET') THEN
    bad := bad || 'la aplicación puede actuar como migrador'::text;
  END IF;
  IF has_schema_privilege(a, s, 'CREATE') THEN
    bad := bad || format('la aplicación tiene CREATE en el esquema %s', s);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = s AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = m)) THEN
    bad := bad || format('hay relaciones del esquema %s que no son del migrador', s);
  END IF;
  FOR r IN SELECT * FROM _app_tables LOOP
    IF has_table_privilege(a, r.oid, 'TRUNCATE') OR has_table_privilege(a, r.oid, 'TRIGGER')
       OR has_table_privilege(a, r.oid, 'REFERENCES') THEN
      bad := bad || format('%s: TRUNCATE/TRIGGER/REFERENCES', r.relname);
    END IF;
    IF r.append_only AND (has_table_privilege(a, r.oid, 'UPDATE') OR has_table_privilege(a, r.oid, 'DELETE')) THEN
      bad := bad || format('%s es append-only y tiene UPDATE/DELETE', r.relname);
    END IF;
    IF NOT r.delete_allowed AND has_table_privilege(a, r.oid, 'DELETE') THEN
      bad := bad || format('%s tiene DELETE', r.relname);
    END IF;
  END LOOP;
  IF to_regclass(format('%I._prisma_migrations', s)) IS NOT NULL
     AND has_table_privilege(a, format('%I._prisma_migrations', s), 'SELECT,INSERT,UPDATE,DELETE') THEN
    bad := bad || 'la aplicación tiene acceso a _prisma_migrations'::text;
  END IF;
  IF to_regclass(format('%I.sync_row_version_seq', s)) IS NOT NULL THEN
    IF NOT has_sequence_privilege(a, format('%I.sync_row_version_seq', s), 'USAGE') THEN
      bad := bad || 'falta USAGE en sync_row_version_seq'::text;
    END IF;
    IF has_sequence_privilege(a, format('%I.sync_row_version_seq', s), 'UPDATE') THEN
      bad := bad || 'la aplicación puede hacer setval en sync_row_version_seq'::text;
    END IF;
  END IF;

  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'Permisos inválidos: %', array_to_string(bad, '; ');
  END IF;
  RAISE NOTICE 'Roles y permisos aplicados en %.% (migrador=%, aplicación=%)',
    current_database(), s, m, a;
END $$;

COMMIT;

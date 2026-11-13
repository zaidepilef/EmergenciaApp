import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, insertUser, pgError, testDatabaseUrl, withRollback } from "./db";

// P-2 de docs/devops/local-environment.md: aplica deploy/postgres/roles.sql a la
// base *_test y comprueba, conectado como el rol de la APLICACIÓN, que el flujo
// normal funciona y que las barreras de permisos se cumplen aunque falle el
// trigger (segunda barrera de schema.md §2).
//
// Los roles son de la instancia, no de la base: se usan nombres exclusivos de
// prueba para no tocar emergencia_migrator / emergencia_app. Las contraseñas se
// generan en cada corrida y solo viajan por variables de entorno.
// Requiere el servicio "postgres" de compose.yaml corriendo (npm run db:up): el
// script usa psql 15+ (\getenv, \gexec) y se ejecuta con el psql del contenedor.

const MIGRATOR_ROLE = "emergencia_test_migrator";
const APP_ROLE = "emergencia_test_app";
const migratorPassword = randomBytes(24).toString("hex");
const appPassword = randomBytes(24).toString("hex");

const adminUrl = new URL(testDatabaseUrl());
const dbName = adminUrl.pathname.replace(/^\//, "");

function urlFor(user: string, password: string): string {
  const u = new URL(adminUrl);
  u.username = user;
  u.password = password;
  return u.toString();
}

function applyRolesScript(): void {
  const env = {
    ...process.env,
    PG_MIGRATOR_ROLE: MIGRATOR_ROLE,
    PG_APP_ROLE: APP_ROLE,
    PG_MIGRATOR_PASSWORD: migratorPassword,
    PG_APP_PASSWORD: appPassword,
  };
  const passEnv = ["PG_MIGRATOR_ROLE", "PG_APP_ROLE", "PG_MIGRATOR_PASSWORD", "PG_APP_PASSWORD"].flatMap(
    (name) => ["-e", name],
  );
  const result = spawnSync(
    "docker",
    [
      "compose", "-f", "../compose.yaml", "exec", "-T", ...passEnv, "postgres",
      "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
      "-U", decodeURIComponent(adminUrl.username), "-d", dbName, "-f", "-",
    ],
    { input: readFileSync("../deploy/postgres/roles.sql"), env, encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `roles.sql falló (¿está corriendo "npm run db:up"?):\n${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
    );
  }
}

let app: pg.Pool;

beforeAll(() => {
  applyRolesScript();
  app = new pg.Pool({ connectionString: urlFor(APP_ROLE, appPassword), max: 3 });
});
afterAll(() => app?.end());

const DENIED = "42501"; // insufficient_privilege

describe("rol migrador (P-1)", () => {
  it("prisma migrate deploy con MIGRATION_DATABASE_URL del migrador no tiene nada pendiente", () => {
    const result = spawnSync("npx prisma migrate deploy", {
      shell: true,
      encoding: "utf8",
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: urlFor(MIGRATOR_ROLE, migratorPassword),
        DATABASE_URL: urlFor(APP_ROLE, appPassword),
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/No pending migrations/i);
  });

  it("el rol de la aplicación no puede leer _prisma_migrations", async () => {
    await withRollback(app, async (c) => {
      expect((await pgError(c, "SELECT count(*) FROM _prisma_migrations"))?.code).toBe(DENIED);
    });
  });
});

describe("rol de la aplicación: lo permitido", () => {
  it("no es superusuario ni dueño de las tablas", async () => {
    const { rows } = await app.query<{ su: boolean; owns: number }>(
      `SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su,
              (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS owns`,
    );
    expect(rows[0]).toEqual({ su: false, owns: 0 });
  });

  it("crea el flujo completo (incluidas las 8 tablas append-only) y row_version funciona", async () => {
    await withRollback(app, async (c) => {
      const f = await createFixture(c);
      const { rows } = await c.query<{ row_version: string }>(
        "SELECT row_version FROM emergency_response WHERE id = $1",
        [f.operationIds.response],
      );
      expect(BigInt(rows[0]!.row_version)).toBeGreaterThan(0n);
    });
  });

  it("actualiza una tabla no append-only y la versión de fila avanza", async () => {
    await withRollback(app, async (c) => {
      const u = await insertUser(c);
      const { rows } = await c.query<{ row_version: string }>(
        "UPDATE app_user SET full_name = 'Otro nombre' WHERE id = $1 RETURNING row_version",
        [u.id],
      );
      expect(BigInt(rows[0]!.row_version)).toBeGreaterThan(u.rowVersion);
    });
  });

  it("puede borrar en user_role (única tabla con DELETE)", async () => {
    await withRollback(app, async (c) => {
      const u = await insertUser(c);
      await c.query("INSERT INTO user_role (user_id, role) VALUES ($1, 'COORDINADOR')", [u.id]);
      const { rowCount } = await c.query("DELETE FROM user_role WHERE user_id = $1", [u.id]);
      expect(rowCount).toBe(1);
    });
  });
});

describe("rol de la aplicación: lo prohibido (42501 antes de llegar al trigger)", () => {
  const APPEND_ONLY = [
    "audit_log",
    "availability_change",
    "emergency_notice",
    "emergency_response",
    "manual_contact",
    "notice_ack",
    "sync_operation",
    "sync_operation_resolution",
  ];

  it.each(APPEND_ONLY)("UPDATE y DELETE en %s", async (table) => {
    await withRollback(app, async (c) => {
      expect((await pgError(c, `UPDATE ${table} SET ${await anyColumn(c, table)} = ${await anyColumn(c, table)}`))?.code).toBe(DENIED);
      expect((await pgError(c, `DELETE FROM ${table}`))?.code).toBe(DENIED);
    });
  });

  it.each([
    ["DELETE fuera de user_role", "DELETE FROM app_user"],
    ["TRUNCATE", "TRUNCATE emergency_response"],
    ["desactivar triggers", "ALTER TABLE emergency_response DISABLE TRIGGER USER"],
    ["session_replication_role", "SET session_replication_role = replica"],
    ["DDL en el esquema", "CREATE TABLE intruder (id int)"],
    ["reemplazar funciones", "CREATE OR REPLACE FUNCTION set_row_version() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$"],
    ["setval en la secuencia", "SELECT setval('sync_row_version_seq', 1)"],
    ["tablas temporales", "CREATE TEMP TABLE scratch (id int)"],
  ])("%s", async (_label, sql) => {
    await withRollback(app, async (c) => {
      expect((await pgError(c, sql))?.code).toBe(DENIED);
    });
  });
});

async function anyColumn(c: pg.ClientBase, table: string): Promise<string> {
  const { rows } = await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position LIMIT 1`,
    [table],
  );
  return rows[0]!.column_name;
}

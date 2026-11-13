import { afterAll, describe, expect, it } from "vitest";
import { createFixture, insertUser, newPool, nextRut, pgError, withRollback } from "./db";

const pool = newPool(5);
afterAll(() => pool.end());

const REPLICATED_TABLES = [
  "app_user",
  "availability_change",
  "brigadista_profile",
  "emergency",
  "emergency_notice",
  "emergency_recipient",
  "emergency_response",
];

const APPEND_ONLY_TABLES = [
  "audit_log",
  "availability_change",
  "emergency_notice",
  "emergency_response",
  "manual_contact",
  "notice_ack",
  "sync_operation",
  "sync_operation_resolution",
];

describe("versión de fila (versioning.md §2 y §5)", () => {
  it("la secuencia sync_row_version_seq tiene CACHE 1", async () => {
    const { rows } = await pool.query(
      `SELECT cache_size::int AS cache_size, data_type::text AS data_type
       FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'sync_row_version_seq'`,
    );
    expect(rows).toEqual([{ cache_size: 1, data_type: "bigint" }]);
  });

  it("toda tabla con row_version es replicada, NOT NULL y tiene el trigger BEFORE INSERT OR UPDATE", async () => {
    const { rows: cols } = await pool.query<{ table_name: string; is_nullable: string }>(
      `SELECT table_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'row_version' ORDER BY table_name`,
    );
    expect(cols.map((r) => r.table_name)).toEqual(REPLICATED_TABLES);
    expect(cols.every((r) => r.is_nullable === "NO")).toBe(true);

    // tgtype: bit 0 ROW, bit 1 BEFORE, bit 2 INSERT, bit 4 UPDATE.
    const { rows: trg } = await pool.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE n.nspname = 'public' AND p.proname = 'set_row_version' AND NOT t.tgisinternal
         AND t.tgenabled = 'O' AND (t.tgtype & 23) = 23
       ORDER BY c.relname`,
    );
    expect(trg.map((r) => r.table_name)).toEqual(REPLICATED_TABLES);
  });

  it("toda tabla replicada tiene CHECK (row_version > 0)", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
       WHERE k.contype = 'c' AND pg_get_constraintdef(k.oid) = 'CHECK ((row_version > 0))'
       ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(REPLICATED_TABLES);
  });

  it("sin el trigger, el DEFAULT 0 es rechazado por el CHECK", async () => {
    await withRollback(pool, async (c) => {
      await c.query(`ALTER TABLE app_user DISABLE TRIGGER app_user_row_version`);
      const err = await pgError(
        c,
        `INSERT INTO app_user (rut, password_hash, full_name, must_change_password)
         VALUES ($1, 'x', 'Sin trigger', false)`,
        [nextRut()],
      );
      expect(err).toMatchObject({ code: "23514", constraint: "app_user_row_version_chk" });
    });
  });

  it("el trigger asigna versiones crecientes también en UPDATE", async () => {
    await withRollback(pool, async (c) => {
      const u = await insertUser(c);
      const { rows } = await c.query<{ row_version: string }>(
        `UPDATE app_user SET full_name = 'Otro nombre' WHERE id = $1 RETURNING row_version`,
        [u.id],
      );
      expect(BigInt(rows[0]!.row_version)).toBeGreaterThan(u.rowVersion);
    });
  });
});

describe("tablas append-only (forbid_mutation)", () => {
  it("el trigger existe en exactamente las 8 tablas", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE p.proname = 'forbid_mutation' AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND (t.tgtype & 27) = 27  -- ROW + BEFORE + DELETE + UPDATE
       ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(APPEND_ONLY_TABLES);
  });

  it.each(APPEND_ONLY_TABLES)("%s rechaza UPDATE y DELETE", async (table) => {
    await withRollback(pool, async (c) => {
      await createFixture(c);
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n).toBeGreaterThan(0);

      // Columna de tipo fecha presente en cada tabla, para un UPDATE válido.
      const { rows: col } = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'timestamp with time zone'
         ORDER BY ordinal_position LIMIT 1`,
        [table],
      );
      const tsCol = col[0]!.column_name;

      const upd = await pgError(c, `UPDATE ${table} SET ${tsCol} = ${tsCol}`);
      expect(upd).toMatchObject({ code: "P0001" });
      expect(upd!.message).toContain(`La tabla ${table} es append-only`);

      const del = await pgError(c, `DELETE FROM ${table}`);
      expect(del).toMatchObject({ code: "P0001" });
      expect(del!.message).toContain(`La tabla ${table} es append-only`);
    });
  });
});

describe("restricciones CHECK y únicas clave", () => {
  const insertUserSql = `INSERT INTO app_user (rut, password_hash, full_name, must_change_password, password_expires_at)
                         VALUES ($1, 'x', 'Prueba', $2, $3)`;

  it("contraseña provisoria ⇔ vencimiento", async () => {
    await withRollback(pool, async (c) => {
      const future = new Date(Date.now() + 86_400_000);
      expect(await pgError(c, insertUserSql, [nextRut(), true, future])).toBeNull();
      expect(await pgError(c, insertUserSql, [nextRut(), false, null])).toBeNull();
      expect(await pgError(c, insertUserSql, [nextRut(), true, null])).toMatchObject({
        code: "23514",
        constraint: "app_user_provisional_chk",
      });
      expect(await pgError(c, insertUserSql, [nextRut(), false, future])).toMatchObject({
        code: "23514",
        constraint: "app_user_provisional_chk",
      });
    });
  });

  it.each([
    ["con puntos", "12.345.678-5"],
    ["con cero inicial", "012345678-5"],
    ["DV en minúscula", "1000005-k"],
    ["sin guion", "123456785"],
    ["cuerpo de 9 dígitos", "123456789-0"],
    ["DV inválido (letra)", "12345678-X"],
    ["vacío", ""],
  ])("RUT con formato inválido es rechazado: %s", async (_label, rut) => {
    await withRollback(pool, async (c) => {
      expect(await pgError(c, insertUserSql, [rut, false, null])).toMatchObject({
        code: "23514",
        constraint: "app_user_rut_format_chk",
      });
    });
  });

  it("RUT en formato canónico es aceptado (incluido DV K)", async () => {
    await withRollback(pool, async (c) => {
      expect(await pgError(c, insertUserSql, ["1000005-K", false, null])).toBeNull();
      expect(await pgError(c, insertUserSql, ["12345678-5", false, null])).toBeNull();
    });
  });

  it("a lo sumo una convocatoria ACTIVE", async () => {
    await withRollback(pool, async (c) => {
      const f = await createFixture(c); // ya deja una convocatoria ACTIVE
      const insertEmergency = `INSERT INTO emergency (emergency_type, meeting_point, scheduled_at, created_by, status, activated_by, activated_at)
                               VALUES ('OTRA', 'Plaza', now(), $1, $2, $3, $4)`;
      expect(
        await pgError(c, insertEmergency, [f.coordinatorId, "ACTIVE", f.coordinatorId, new Date()]),
      ).toMatchObject({ code: "23505", constraint: "emergency_one_active_uq" });
      // Borradores ilimitados.
      expect(await pgError(c, insertEmergency, [f.coordinatorId, "DRAFT", null, null])).toBeNull();
      expect(await pgError(c, insertEmergency, [f.coordinatorId, "DRAFT", null, null])).toBeNull();
      // Al cerrar la activa, se puede activar otra.
      await c.query(
        `UPDATE emergency SET status = 'CLOSED', closed_at = now(), closed_by = $2 WHERE id = $1`,
        [f.emergencyId, f.coordinatorId],
      );
      expect(
        await pgError(c, insertEmergency, [f.coordinatorId, "ACTIVE", f.coordinatorId, new Date()]),
      ).toBeNull();
    });
  });

  it("a lo sumo una resolución final por operación; notas ilimitadas", async () => {
    await withRollback(pool, async (c) => {
      const f = await createFixture(c); // ya deja una NOTE sobre operationIds.response
      const insertResolution = `INSERT INTO sync_operation_resolution (operation_id, action, resolved_by, note)
                                VALUES ($1, $2, $3, $4)`;
      const opId = f.operationIds.response;
      expect(await pgError(c, insertResolution, [opId, "NOTE", f.coordinatorId, "otra nota"])).toBeNull();
      expect(await pgError(c, insertResolution, [opId, "CONFIRMED", f.coordinatorId, null])).toBeNull();
      expect(await pgError(c, insertResolution, [opId, "DISMISSED", f.coordinatorId, null])).toMatchObject({
        code: "23505",
        constraint: "resolution_final_uq",
      });
      expect(await pgError(c, insertResolution, [opId, "NOTE", f.coordinatorId, "nota posterior"])).toBeNull();
    });
  });
});

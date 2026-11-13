import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

// La base de pruebas se BORRA en cada corrida. Esta función se niega a devolver
// una URL que no sea local y de una base *_test.
export function testDatabaseUrl(): string {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const raw = process.env["TEST_DATABASE_URL"];
  if (!raw) {
    throw new Error("Falta TEST_DATABASE_URL (ver backend/.env.example).");
  }
  const url = new URL(raw);
  const dbName = url.pathname.replace(/^\//, "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !dbName.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL debe apuntar a localhost y a una base *_test (recibido host=${url.hostname}, base=${dbName}).`,
    );
  }
  return raw;
}

export function newPool(max = 20): pg.Pool {
  return new pg.Pool({ connectionString: testDatabaseUrl(), max });
}

export async function newClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  return client;
}

/** Ejecuta fn dentro de una transacción que siempre se revierte. */
export async function withRollback<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

export interface PgErrorInfo {
  code: string | undefined;
  constraint: string | undefined;
  message: string;
}

/**
 * Ejecuta sql dentro de un SAVEPOINT y devuelve el error de PostgreSQL (o null
 * si no falló). La transacción externa sigue usable.
 */
export async function pgError(
  c: pg.ClientBase,
  sql: string,
  params: unknown[] = [],
): Promise<PgErrorInfo | null> {
  await c.query("SAVEPOINT probe");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT probe");
    return null;
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT probe");
    const e = err as pg.DatabaseError;
    return { code: e.code, constraint: e.constraint, message: e.message };
  }
}

/** Dígito verificador de RUT (módulo 11). */
export function rutDv(body: number): string {
  let sum = 0;
  let factor = 2;
  for (const d of String(body).split("").reverse()) {
    sum += Number(d) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

let rutCounter = 10_000_000 + Math.floor(Math.random() * 1_000_000);
/** RUT válido y único dentro de la corrida (formato canónico 12345678-K). */
export function nextRut(): string {
  rutCounter += 1;
  return `${rutCounter}-${rutDv(rutCounter)}`;
}

export async function insertUser(
  c: pg.ClientBase,
  fullName = "Usuario de prueba",
): Promise<{ id: string; rowVersion: bigint }> {
  const { rows } = await c.query<{ id: string; row_version: string }>(
    `INSERT INTO app_user (rut, password_hash, full_name, must_change_password)
     VALUES ($1, 'not-a-real-hash', $2, false)
     RETURNING id, row_version`,
    [nextRut(), fullName],
  );
  const row = rows[0]!;
  return { id: row.id, rowVersion: BigInt(row.row_version) };
}

export interface Fixture {
  coordinatorId: string;
  brigadistaUserId: string;
  brigadistaId: string;
  deviceId: string;
  emergencyId: string;
  noticeId: string;
  recipientId: string;
  operationIds: { availability: string; response: string; ack: string };
}

/**
 * Crea una fila en cada tabla del flujo principal (incluidas las 8
 * append-only). Pensado para usarse dentro de withRollback.
 */
export async function createFixture(c: pg.ClientBase): Promise<Fixture> {
  const coordinator = await insertUser(c, "Coordinador de prueba");
  const brigUser = await insertUser(c, "Brigadista de prueba");
  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<T> =>
    (await c.query<T>(sql, params)).rows[0]!;

  const { id: brigadistaId } = await one<{ id: string }>(
    `INSERT INTO brigadista_profile (user_id, availability_declared_at) VALUES ($1, now()) RETURNING id`,
    [brigUser.id],
  );
  const deviceId = randomUUID();
  await c.query(`INSERT INTO device (id, user_id, platform) VALUES ($1, $2, 'ANDROID')`, [
    deviceId,
    brigUser.id,
  ]);

  const op = async (seq: number, type: string): Promise<string> => {
    const id = randomUUID();
    await c.query(
      `INSERT INTO sync_operation (operation_id, device_id, user_id, device_seq, operation_type, payload, result)
       VALUES ($1, $2, $3, $4, $5, '{}', 'APPLIED')`,
      [id, deviceId, brigUser.id, seq, type],
    );
    return id;
  };
  const operationIds = {
    availability: await op(1, "DECLARE_AVAILABILITY"),
    response: await op(2, "RESPOND_EMERGENCY"),
    ack: await op(3, "ACK_NOTICE"),
  };

  await c.query(
    `INSERT INTO availability_change (id, brigadista_id, status, source, declared_at, estimated_at,
       time_confidence, device_id, device_seq, sync_result)
     VALUES ($1, $2, 'DISPONIBLE', 'APP', now() - interval '1 minute', now() - interval '1 minute',
       'MONOTONIC', $3, 1, 'APPLIED')`,
    [operationIds.availability, brigadistaId, deviceId],
  );

  const { id: emergencyId } = await one<{ id: string }>(
    `INSERT INTO emergency (emergency_type, meeting_point, scheduled_at, created_by, status, activated_by, activated_at)
     VALUES ('INCENDIO', 'Cuartel', now(), $1, 'ACTIVE', $1, now()) RETURNING id`,
    [coordinator.id],
  );
  const { id: noticeId } = await one<{ id: string }>(
    `INSERT INTO emergency_notice (emergency_id, kind, created_by) VALUES ($1, 'ACTIVATION', $2) RETURNING id`,
    [emergencyId, coordinator.id],
  );
  const { id: recipientId } = await one<{ id: string }>(
    `INSERT INTO emergency_recipient (emergency_id, brigadista_id, added_reason)
     VALUES ($1, $2, 'ACTIVATION') RETURNING id`,
    [emergencyId, brigadistaId],
  );
  await c.query(
    `INSERT INTO emergency_response (id, recipient_id, response, source, channel, declared_at, estimated_at,
       time_confidence, device_id, device_seq, sync_result)
     VALUES ($1, $2, 'VOY', 'APP', 'APP', now() - interval '1 minute', now() - interval '1 minute',
       'MONOTONIC', $3, 2, 'APPLIED')`,
    [operationIds.response, recipientId, deviceId],
  );
  await c.query(
    `INSERT INTO notice_ack (id, notice_id, recipient_id, device_id, level, via, acked_at_device, operation_id)
     VALUES ($1, $2, $3, $4, 'OPENED', NULL, now(), $5)`,
    [randomUUID(), noticeId, recipientId, deviceId, operationIds.ack],
  );
  await c.query(
    `INSERT INTO manual_contact (recipient_id, channel, outcome, occurred_at, recorded_by)
     VALUES ($1, 'PHONE_CALL', 'ANSWERED', now() - interval '1 minute', $2)`,
    [recipientId, coordinator.id],
  );
  await c.query(
    `INSERT INTO sync_operation_resolution (operation_id, action, resolved_by, note)
     VALUES ($1, 'NOTE', $2, 'nota de prueba')`,
    [operationIds.response, coordinator.id],
  );
  await c.query(`INSERT INTO audit_log (actor_user_id, action) VALUES ($1, 'TEST_FIXTURE')`, [
    coordinator.id,
  ]);

  return {
    coordinatorId: coordinator.id,
    brigadistaUserId: brigUser.id,
    brigadistaId,
    deviceId,
    emergencyId,
    noticeId,
    recipientId,
    operationIds,
  };
}

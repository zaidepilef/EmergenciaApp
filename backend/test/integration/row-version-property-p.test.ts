import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { newClient, newPool, nextRut } from "./db";

// Propiedad P (docs/database/synchronization/versioning.md §1 y §6): si una
// descarga vio una fila con versión v, ninguna fila con versión u < v puede
// confirmarse después. Se verifica con escritores concurrentes (pausas antes del
// commit y abortos) y un lector que sigue el protocolo de descarga de §4.

const pool = newPool(20);
afterAll(() => pool.end());

interface Row {
  id: string;
  version: bigint;
}

async function insertMarked(c: pg.ClientBase, marker: string): Promise<Row> {
  const { rows } = await c.query<{ id: string; row_version: string }>(
    `INSERT INTO app_user (rut, password_hash, full_name, must_change_password)
     VALUES ($1, 'x', $2, false) RETURNING id, row_version`,
    [nextRut(), marker],
  );
  return { id: rows[0]!.id, version: BigInt(rows[0]!.row_version) };
}

/** Una página de descarga según versioning.md §4 (una transacción REPEATABLE READ READ ONLY). */
async function downloadPage(reader: pg.Client, marker: string, cursor: bigint, limit = 20): Promise<Row[]> {
  await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const { rows } = await reader.query<{ id: string; row_version: string }>(
      `SELECT id, row_version FROM app_user
       WHERE full_name = $1 AND row_version > $2
       ORDER BY row_version LIMIT $3`,
      [marker, cursor.toString(), limit],
    );
    return rows.map((r) => ({ id: r.id, version: BigInt(r.row_version) }));
  } finally {
    await reader.query("COMMIT");
  }
}

interface StressResult {
  committed: Row[];
  aborted: number;
  seen: Set<string>;
  lost: Row[];
  cursors: bigint[];
}

async function runStress(opts: {
  writers: number;
  txPerWriter: number;
  maxDelayMs: number;
  abortRate: number;
}): Promise<StressResult> {
  const marker = `property-p ${randomUUID()}`;
  const committed: Row[] = [];
  let aborted = 0;
  let writersDone = false;

  const writer = async (): Promise<void> => {
    for (let i = 0; i < opts.txPerWriter; i++) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const rows: Row[] = [];
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) rows.push(await insertMarked(c, marker));
        await sleep(Math.random() * opts.maxDelayMs);
        if (Math.random() < opts.abortRate) {
          await c.query("ROLLBACK");
          aborted++;
        } else {
          await c.query("COMMIT");
          committed.push(...rows);
        }
      } finally {
        c.release();
      }
      await sleep(Math.random() * 2);
    }
  };

  const reader = await newClient();
  const seen = new Set<string>();
  const cursors: bigint[] = [];
  let cursor = 0n;
  const readerLoop = async (): Promise<void> => {
    for (;;) {
      const done = writersDone; // leído ANTES de la página: la última pasada ve todo
      const page = await downloadPage(reader, marker, cursor);
      for (const r of page) {
        // Ninguna fila puede llegar con versión ≤ cursor ya alcanzado.
        expect(r.version).toBeGreaterThan(cursor);
        seen.add(r.id);
      }
      if (page.length > 0) {
        cursor = page[page.length - 1]!.version; // cursor = última fila devuelta
        cursors.push(cursor);
      } else if (done) {
        return;
      } else {
        await sleep(1);
      }
    }
  };

  try {
    const readerPromise = readerLoop();
    await Promise.all(Array.from({ length: opts.writers }, writer));
    writersDone = true;
    await readerPromise;
  } finally {
    await reader.end();
  }

  const lost = committed.filter((r) => !seen.has(r.id));
  return { committed, aborted, seen, lost, cursors };
}

async function withoutLock<T>(fn: () => Promise<T>): Promise<T> {
  const { rows } = await pool.query<{ def: string }>(
    `SELECT pg_get_functiondef('set_row_version'::regproc) AS def`,
  );
  const original = rows[0]!.def;
  expect(original).toContain("pg_advisory_xact_lock(7352001)");
  await pool.query(`
    CREATE OR REPLACE FUNCTION set_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.row_version := nextval('sync_row_version_seq');
      RETURN NEW;
    END $$`);
  try {
    return await fn();
  } finally {
    await pool.query(original);
    const { rows: after } = await pool.query<{ def: string }>(
      `SELECT pg_get_functiondef('set_row_version'::regproc) AS def`,
    );
    expect(after[0]!.def).toContain("pg_advisory_xact_lock(7352001)");
  }
}

/**
 * Escenario determinista del §1: A toma una versión, B toma una mayor y confirma,
 * el lector descarga y avanza el cursor, después A confirma.
 */
async function interleavedScenario(): Promise<{ lostA: boolean; bBlocked: boolean }> {
  const marker = `property-p-det ${randomUUID()}`;
  const a = await newClient();
  const b = await newClient();
  const reader = await newClient();
  try {
    await a.query("BEGIN");
    const rowA = await insertMarked(a, marker);

    await b.query("BEGIN");
    let bDone = false;
    const bInsert = insertMarked(b, marker).then(async (row) => {
      bDone = true;
      await b.query("COMMIT");
      return row;
    });
    await sleep(500);
    const bBlocked = !bDone;

    let cursor = 0n;
    if (!bBlocked) {
      await bInsert; // B ya confirmó
      const page = await downloadPage(reader, marker, cursor);
      if (page.length > 0) cursor = page[page.length - 1]!.version;
    }
    await a.query("COMMIT");
    await bInsert;

    const seen = new Set<string>();
    if (!bBlocked) {
      // Las descargas siguientes solo piden versiones > cursor.
      for (const r of await downloadPage(reader, marker, cursor)) seen.add(r.id);
    } else {
      for (const r of await downloadPage(reader, marker, 0n)) seen.add(r.id);
    }
    return { lostA: !seen.has(rowA.id), bBlocked };
  } finally {
    await Promise.all([a.end(), b.end(), reader.end()]);
  }
}

describe("propiedad P con el candado (configuración real)", () => {
  it("escenario determinista: el segundo escritor espera al primero y nada se pierde", async () => {
    const r = await interleavedScenario();
    expect(r.bBlocked).toBe(true);
    expect(r.lostA).toBe(false);
  });

  it("estrés: escritores concurrentes con pausas y abortos; ninguna fila confirmada se pierde", async () => {
    const r = await runStress({ writers: 8, txPerWriter: 30, maxDelayMs: 8, abortRate: 0.2 });
    expect(r.committed.length).toBeGreaterThan(100);
    expect(r.aborted).toBeGreaterThan(0);
    expect(r.cursors.length).toBeGreaterThan(1);
    console.info(`con candado: ${r.committed.length} filas confirmadas, ${r.aborted} abortos, ${r.cursors.length} páginas, 0 perdidas esperadas (${r.lost.length})`);
    expect(r.lost).toEqual([]);
    expect(r.seen.size).toBe(r.committed.length);
  });
});

describe("variante negativa: sin el candado la prueba detecta pérdidas", () => {
  it("escenario determinista: sin candado la fila de A se pierde", async () => {
    const r = await withoutLock(interleavedScenario);
    expect(r.bBlocked).toBe(false);
    expect(r.lostA).toBe(true);
  });

  // No determinista: depende del entrelazado real. Se repite hasta 5 rondas;
  // en la práctica la primera ya pierde filas. Si alguna vez no detectara
  // pérdidas, el escenario determinista de arriba sigue cubriendo la variante.
  it("estrés: sin candado se pierden filas confirmadas", async () => {
    const totalLost = await withoutLock(async () => {
      for (let round = 0; round < 5; round++) {
        const r = await runStress({ writers: 8, txPerWriter: 30, maxDelayMs: 8, abortRate: 0.2 });
        console.info(`sin candado, ronda ${round + 1}: ${r.lost.length} de ${r.committed.length} filas confirmadas perdidas`);
        if (r.lost.length > 0) return r.lost.length;
      }
      return 0;
    });
    expect(totalLost).toBeGreaterThan(0);
  });
});

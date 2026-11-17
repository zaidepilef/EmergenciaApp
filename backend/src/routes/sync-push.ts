import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { prisma, replicatedWrite, toNum, type Tx } from "../db.js";
import { config } from "../config.js";
import { guard } from "../auth/guard.js";
import { ApiError } from "../http/problem.js";
import { sha256 } from "../auth/tokens.js";
import type { AvailabilityStatus, SyncResult, TimeConfidence } from "../generated/prisma/client.js";
import { AVAILABILITY_STATUSES } from "../availability.js";

// ─────────────── Tipos y validación ───────────────

interface Clock {
  deviceNow: string;
  monotonicMs: number | null;
  bootSessionId: string | null;
}

/** Operación tal como llega; solo el sobre está validado (operationId, deviceSeq, type). */
type RawOperation = Record<string, unknown> & { operationId: string; deviceSeq: number; type: string };

interface Body {
  clock: Clock;
  operations: RawOperation[];
}

type ResultCode =
  | "EQUIVALENT_ACK"
  | "AMBIGUOUS_ORDER"
  | "LATE_AFTER_CLOSE"
  | "EMERGENCY_CLOSED"
  | "NOT_A_RECIPIENT"
  | "ACCOUNT_INACTIVE"
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_OPERATION";

interface OperationResult {
  operationId: string;
  result: SyncResult;
  code: ResultCode | null;
  duplicate: boolean;
  entityId: string | null;
  rowVersion: number | null;
  lateSyncAfterClose: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_TYPES = new Set(["DECLARE_AVAILABILITY", "RESPOND_EMERGENCY", "ACK_NOTICE", "REGISTER_PUSH_TOKEN"]);
const BASE_KEYS = ["operationId", "deviceSeq", "type", "declaredAt", "declaredMonotonicMs", "bootSessionId", "createdOffline"];

const envelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["clock", "operations"],
  properties: {
    clock: {
      type: "object",
      additionalProperties: false,
      required: ["deviceNow", "monotonicMs", "bootSessionId"],
      properties: {
        deviceNow: { type: "string", format: "date-time" },
        monotonicMs: { type: ["integer", "null"], minimum: 0 },
        bootSessionId: { type: ["string", "null"], minLength: 1, maxLength: 64 },
      },
    },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        required: ["operationId", "deviceSeq", "type"],
        properties: {
          operationId: { type: "string", format: "uuid" },
          deviceSeq: { type: "integer", minimum: 1 },
          type: { type: "string", minLength: 1, maxLength: 64 },
        },
      },
    },
  },
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIntOrNull = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0);
const isBootId = (v: unknown) => v === null || (typeof v === "string" && v.length >= 1 && v.length <= 64);
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

function validBase(op: RawOperation, extraKeys: string[]): boolean {
  return (
    onlyKeys(op, [...BASE_KEYS, ...extraKeys]) &&
    typeof op["declaredAt"] === "string" &&
    !Number.isNaN(Date.parse(op["declaredAt"])) &&
    isIntOrNull(op["declaredMonotonicMs"]) &&
    "declaredMonotonicMs" in op &&
    isBootId(op["bootSessionId"]) &&
    "bootSessionId" in op &&
    typeof op["createdOffline"] === "boolean"
  );
}

interface RespondOp {
  baseRowVersion: number;
  payload: { recipientId: string; response: "VOY" | "NO_PUEDO" };
}
function asRespond(op: RawOperation): RespondOp | null {
  const p = op["payload"];
  if (!validBase(op, ["baseRowVersion", "payload"])) return null;
  if (!Number.isInteger(op["baseRowVersion"]) || (op["baseRowVersion"] as number) < 0) return null;
  if (!isObj(p) || !onlyKeys(p, ["recipientId", "response"])) return null;
  if (typeof p["recipientId"] !== "string" || !UUID_RE.test(p["recipientId"])) return null;
  if (p["response"] !== "VOY" && p["response"] !== "NO_PUEDO") return null;
  return op as unknown as RespondOp;
}

interface AvailabilityOp {
  baseRowVersion: number;
  payload: { status: AvailabilityStatus };
}
function asAvailability(op: RawOperation): AvailabilityOp | null {
  const p = op["payload"];
  if (!validBase(op, ["baseRowVersion", "payload"])) return null;
  if (!Number.isInteger(op["baseRowVersion"]) || (op["baseRowVersion"] as number) < 0) return null;
  if (!isObj(p) || !onlyKeys(p, ["status"])) return null;
  if (!(AVAILABILITY_STATUSES as readonly unknown[]).includes(p["status"])) return null;
  return op as unknown as AvailabilityOp;
}

interface AckOp {
  payload: { noticeId: string; recipientId: string; level: "RECEIVED" | "OPENED"; via?: "PUSH" | "SYNC" };
}
function asAck(op: RawOperation): AckOp | null {
  const p = op["payload"];
  if (!validBase(op, ["payload"]) || !isObj(p)) return null;
  if (typeof p["noticeId"] !== "string" || !UUID_RE.test(p["noticeId"])) return null;
  if (typeof p["recipientId"] !== "string" || !UUID_RE.test(p["recipientId"])) return null;
  if (p["level"] === "RECEIVED") {
    if (!onlyKeys(p, ["noticeId", "recipientId", "level", "via"])) return null;
    if (p["via"] !== "PUSH" && p["via"] !== "SYNC") return null;
  } else if (p["level"] === "OPENED") {
    if (!onlyKeys(p, ["noticeId", "recipientId", "level"])) return null;
  } else return null;
  return op as unknown as AckOp;
}

interface TokenOp {
  payload: { token: string | null };
}
function asToken(op: RawOperation): TokenOp | null {
  const p = op["payload"];
  if (!validBase(op, ["payload"]) || !isObj(p) || !onlyKeys(p, ["token"]) || !("token" in p)) return null;
  const t = p["token"];
  if (t !== null && (typeof t !== "string" || t.length < 1 || t.length > 4096)) return null;
  return op as unknown as TokenOp;
}

/** El token push nunca se guarda en el registro de operaciones: solo su hash. */
function storablePayload(op: RawOperation): object {
  const p = op["payload"];
  if (op.type === "REGISTER_PUSH_TOKEN") {
    const t = isObj(p) ? p["token"] : undefined;
    return { tokenSha256: typeof t === "string" ? sha256(t) : null };
  }
  return isObj(p) ? p : {};
}

// ─────────────── Hora estimada (no depende solo del reloj del teléfono) ───────────────

function estimateTime(op: RawOperation, clock: Clock, receivedAt: Date): { at: Date; confidence: TimeConfidence } {
  const declaredMono = op["declaredMonotonicMs"] as number | null;
  const boot = op["bootSessionId"] as string | null;
  let at: Date;
  let confidence: TimeConfidence;
  if (boot && clock.bootSessionId === boot && declaredMono !== null && clock.monotonicMs !== null && clock.monotonicMs >= declaredMono) {
    at = new Date(receivedAt.getTime() - (clock.monotonicMs - declaredMono));
    confidence = "MONOTONIC";
  } else {
    const offset = receivedAt.getTime() - Date.parse(clock.deviceNow);
    at = new Date(Date.parse(op["declaredAt"] as string) + offset);
    confidence = "CLOCK_OFFSET";
  }
  if (at > receivedAt) at = receivedAt; // nada en el futuro respecto de la recepción
  return { at, confidence };
}

// ─────────────── Procesamiento ───────────────

interface Ctx {
  userId: string;
  deviceId: string;
  clock: Clock;
  receivedAt: Date;
}

async function auditUnrecorded(tx: Tx, ctx: Ctx, op: RawOperation, reason: ResultCode) {
  const already = await tx.auditLog.findFirst({
    where: { entityType: "sync_operation", entityId: op.operationId, action: "SYNC_OPERATION_UNRECORDED" },
  });
  if (already) return;
  const raw = JSON.stringify(op["payload"] ?? null);
  await tx.auditLog.create({
    data: {
      actorUserId: ctx.userId,
      action: "SYNC_OPERATION_UNRECORDED",
      entityType: "sync_operation",
      entityId: op.operationId,
      metadata: {
        reason,
        operationType: op.type.slice(0, 64),
        deviceId: ctx.deviceId,
        deviceSeq: op.deviceSeq,
        payloadSha256: createHash("sha256").update(raw).digest("hex"),
        payloadBytes: Buffer.byteLength(raw),
      },
    },
  });
}

async function recordOperation(
  tx: Tx,
  ctx: Ctx,
  op: RawOperation,
  result: SyncResult,
  code: ResultCode | null,
  entityId: string | null,
) {
  const base = op["baseRowVersion"];
  await tx.syncOperation.create({
    data: {
      operationId: op.operationId,
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      deviceSeq: BigInt(op.deviceSeq),
      operationType: op.type,
      payload: storablePayload(op),
      baseRowVersion: Number.isInteger(base) ? BigInt(base as number) : null,
      entityId,
      result,
      resultCode: code,
      receivedAt: ctx.receivedAt,
    },
  });
  await tx.$executeRaw`UPDATE device SET last_device_seq = GREATEST(last_device_seq, ${op.deviceSeq}) WHERE id = ${ctx.deviceId}::uuid`;
}

const rejected = (op: RawOperation, code: ResultCode, duplicate = false): OperationResult => ({
  operationId: op.operationId,
  result: "REJECTED",
  code,
  duplicate,
  entityId: null,
  rowVersion: null,
  lateSyncAfterClose: false,
});

async function storedResult(tx: Tx, op: RawOperation, stored: { result: SyncResult; resultCode: string | null; entityId: string | null; operationType: string }): Promise<OperationResult> {
  let rowVersion: number | null = null;
  let late = false;
  if (stored.operationType === "DECLARE_AVAILABILITY" && stored.result === "APPLIED") {
    const change = await tx.availabilityChange.findUnique({ where: { id: op.operationId }, include: { brigadista: true } });
    if (change) rowVersion = toNum(change.brigadista.rowVersion);
  }
  if (stored.operationType === "RESPOND_EMERGENCY" && stored.result !== "REJECTED") {
    const resp = await tx.emergencyResponse.findUnique({ where: { id: op.operationId }, include: { recipient: true } });
    if (resp) {
      late = resp.lateSyncAfterClose;
      rowVersion = toNum(resp.recipient.rowVersion);
    }
  }
  return {
    operationId: op.operationId,
    result: stored.result,
    code: stored.resultCode as ResultCode | null,
    duplicate: true,
    entityId: stored.entityId,
    rowVersion,
    lateSyncAfterClose: late,
  };
}

async function processRespond(tx: Tx, ctx: Ctx, op: RawOperation, r: RespondOp): Promise<OperationResult> {
  const recipient = await tx.emergencyRecipient.findUnique({
    where: { id: r.payload.recipientId },
    include: { brigadista: true, emergency: true, currentResponseRef: true },
  });
  if (!recipient || recipient.brigadista.userId !== ctx.userId || !recipient.brigadista.active || recipient.emergency.status === "DRAFT") {
    await recordOperation(tx, ctx, op, "REJECTED", "NOT_A_RECIPIENT", null);
    return rejected(op, "NOT_A_RECIPIENT");
  }

  const { at, confidence } = estimateTime(op, ctx.clock, ctx.receivedAt);
  const win = config.ambiguityWindowMs;
  let result: SyncResult = "APPLIED";
  let code: ResultCode | null = null;
  let becomesCurrent = true;
  let late = false;

  const closedAt = recipient.emergency.closedAt;
  if (recipient.emergency.status === "CLOSED" && closedAt) {
    if (at.getTime() > closedAt.getTime() + win) {
      await recordOperation(tx, ctx, op, "REJECTED", "EMERGENCY_CLOSED", null);
      return rejected(op, "EMERGENCY_CLOSED");
    }
    if (at.getTime() >= closedAt.getTime() - win) {
      result = "CONFLICT";
      code = "LATE_AFTER_CLOSE";
      becomesCurrent = false;
    } else {
      late = true;
    }
  }

  const cur = recipient.currentResponseRef;
  if (result !== "CONFLICT" && cur) {
    if (cur.deviceId === ctx.deviceId && cur.deviceSeq !== null) {
      // Mismo teléfono: manda deviceSeq, sin mirar relojes.
      becomesCurrent = BigInt(op.deviceSeq) > cur.deviceSeq;
    } else if (BigInt(r.baseRowVersion) >= recipient.rowVersion) {
      becomesCurrent = true; // el teléfono veía el estado vigente: nadie escribió entre medio
    } else {
      const delta = at.getTime() - cur.estimatedAt.getTime();
      if (Math.abs(delta) <= win) {
        result = "CONFLICT";
        code = "AMBIGUOUS_ORDER";
        becomesCurrent = true; // desempate por recepción; el coordinador revisa
      } else {
        becomesCurrent = delta > 0;
      }
    }
    if (result === "APPLIED" && !becomesCurrent) result = "SUPERSEDED";
  }

  await recordOperation(tx, ctx, op, result, code, op.operationId);
  await tx.emergencyResponse.create({
    data: {
      id: op.operationId,
      recipientId: recipient.id,
      response: r.payload.response,
      source: "APP",
      channel: "APP",
      declaredAt: new Date(op["declaredAt"] as string),
      estimatedAt: at,
      timeConfidence: confidence,
      receivedAt: ctx.receivedAt,
      deviceId: ctx.deviceId,
      deviceSeq: BigInt(op.deviceSeq),
      baseRowVersion: BigInt(r.baseRowVersion),
      createdOffline: op["createdOffline"] as boolean,
      lateSyncAfterClose: late,
      syncResult: result,
    },
  });

  let rowVersion: number | null = null;
  if (becomesCurrent) {
    const updated = await tx.emergencyRecipient.update({
      where: { id: recipient.id },
      data: { currentResponse: r.payload.response, currentResponseId: op.operationId, respondedAt: at },
    });
    rowVersion = toNum(updated.rowVersion);
  }
  return { operationId: op.operationId, result, code, duplicate: false, entityId: op.operationId, rowVersion, lateSyncAfterClose: late };
}

/**
 * Disponibilidad (design.md §3). Mismo teléfono: manda deviceSeq. Otro teléfono:
 * manda estimatedAt; dentro de la ventana de 60 s gana la que llegó última
 * (Q1, 2026-11-17), sin CONFLICT ni revisión del coordinador.
 */
async function processAvailability(tx: Tx, ctx: Ctx, op: RawOperation, a: AvailabilityOp): Promise<OperationResult> {
  const profile = await tx.brigadistaProfile.findUnique({ where: { userId: ctx.userId }, include: { lastAvailabilityChange: true } });
  if (!profile) {
    await recordOperation(tx, ctx, op, "REJECTED", "INVALID_PAYLOAD", null);
    return rejected(op, "INVALID_PAYLOAD");
  }
  if (!profile.active) {
    await recordOperation(tx, ctx, op, "REJECTED", "ACCOUNT_INACTIVE", null);
    return rejected(op, "ACCOUNT_INACTIVE");
  }

  const { at, confidence } = estimateTime(op, ctx.clock, ctx.receivedAt);
  const cur = profile.lastAvailabilityChange;
  let becomesCurrent = true;
  if (cur) {
    if (cur.deviceId === ctx.deviceId && cur.deviceSeq !== null) {
      becomesCurrent = BigInt(op.deviceSeq) > cur.deviceSeq;
    } else if (BigInt(a.baseRowVersion) >= profile.rowVersion) {
      becomesCurrent = true; // el teléfono veía el estado vigente
    } else {
      const delta = at.getTime() - cur.estimatedAt.getTime();
      becomesCurrent = Math.abs(delta) <= config.ambiguityWindowMs || delta > 0;
    }
  }
  const result: SyncResult = becomesCurrent ? "APPLIED" : "SUPERSEDED";

  await recordOperation(tx, ctx, op, result, null, op.operationId);
  await tx.availabilityChange.create({
    data: {
      id: op.operationId,
      brigadistaId: profile.id,
      status: a.payload.status,
      source: "APP",
      declaredAt: new Date(op["declaredAt"] as string),
      estimatedAt: at,
      timeConfidence: confidence,
      receivedAt: ctx.receivedAt,
      deviceId: ctx.deviceId,
      deviceSeq: BigInt(op.deviceSeq),
      baseRowVersion: BigInt(a.baseRowVersion),
      createdOffline: op["createdOffline"] as boolean,
      syncResult: result,
    },
  });

  let rowVersion: number | null = null;
  if (becomesCurrent) {
    const updated = await tx.brigadistaProfile.update({
      where: { id: profile.id },
      data: {
        availabilityStatus: a.payload.status,
        availabilityDeclaredAt: at,
        lastAvailabilityChangeId: op.operationId,
        updatedAt: ctx.receivedAt,
      },
    });
    rowVersion = toNum(updated.rowVersion);
  }
  return { operationId: op.operationId, result, code: null, duplicate: false, entityId: op.operationId, rowVersion, lateSyncAfterClose: false };
}

async function processAck(tx: Tx, ctx: Ctx, op: RawOperation, a: AckOp): Promise<OperationResult> {
  const [notice, recipient] = await Promise.all([
    tx.emergencyNotice.findUnique({ where: { id: a.payload.noticeId } }),
    tx.emergencyRecipient.findUnique({ where: { id: a.payload.recipientId }, include: { brigadista: true } }),
  ]);
  if (!notice || !recipient || recipient.brigadista.userId !== ctx.userId || notice.emergencyId !== recipient.emergencyId) {
    await recordOperation(tx, ctx, op, "REJECTED", "NOT_A_RECIPIENT", null);
    return rejected(op, "NOT_A_RECIPIENT");
  }
  const existing = await tx.noticeAck.findUnique({
    where: {
      noticeId_recipientId_deviceId_level: {
        noticeId: notice.id,
        recipientId: recipient.id,
        deviceId: ctx.deviceId,
        level: a.payload.level,
      },
    },
  });
  if (existing) {
    await recordOperation(tx, ctx, op, "SUPERSEDED", "EQUIVALENT_ACK", existing.id);
    return { operationId: op.operationId, result: "SUPERSEDED", code: "EQUIVALENT_ACK", duplicate: false, entityId: existing.id, rowVersion: null, lateSyncAfterClose: false };
  }
  await recordOperation(tx, ctx, op, "APPLIED", null, op.operationId);
  await tx.noticeAck.create({
    data: {
      id: op.operationId,
      noticeId: notice.id,
      recipientId: recipient.id,
      deviceId: ctx.deviceId,
      level: a.payload.level,
      via: a.payload.level === "RECEIVED" ? a.payload.via! : null,
      ackedAtDevice: new Date(op["declaredAt"] as string),
      receivedAt: ctx.receivedAt,
      operationId: op.operationId,
    },
  });
  return { operationId: op.operationId, result: "APPLIED", code: null, duplicate: false, entityId: op.operationId, rowVersion: null, lateSyncAfterClose: false };
}

async function processToken(tx: Tx, ctx: Ctx, op: RawOperation, t: TokenOp): Promise<OperationResult> {
  const token = t.payload.token;
  if (token) {
    // Un teléfono físico suena para una sola cuenta: primero se quita al anterior.
    await tx.device.updateMany({
      where: { pushToken: token, id: { not: ctx.deviceId } },
      data: { pushToken: null, pushTokenStatus: null, pushTokenUpdatedAt: ctx.receivedAt },
    });
  }
  await tx.device.update({
    where: { id: ctx.deviceId },
    data: { pushToken: token, pushTokenStatus: token ? "VALID" : null, pushTokenUpdatedAt: ctx.receivedAt },
  });
  await recordOperation(tx, ctx, op, "APPLIED", null, null);
  return { operationId: op.operationId, result: "APPLIED", code: null, duplicate: false, entityId: null, rowVersion: null, lateSyncAfterClose: false };
}

async function processOne(ctx: Ctx, op: RawOperation): Promise<OperationResult> {
  return replicatedWrite(async (tx) => {
    // Después del candado: un reintento concurrente encuentra la operación ya guardada.
    const stored = await tx.syncOperation.findUnique({ where: { operationId: op.operationId } });
    if (stored) {
      if (stored.userId !== ctx.userId) {
        await auditUnrecorded(tx, ctx, op, "INVALID_PAYLOAD");
        return rejected(op, "INVALID_PAYLOAD");
      }
      return storedResult(tx, op, stored);
    }

    if (!KNOWN_TYPES.has(op.type)) {
      await auditUnrecorded(tx, ctx, op, "UNSUPPORTED_OPERATION");
      return rejected(op, "UNSUPPORTED_OPERATION");
    }
    const invalid = async () => {
      await recordOperation(tx, ctx, op, "REJECTED", "INVALID_PAYLOAD", null);
      return rejected(op, "INVALID_PAYLOAD");
    };
    if (op.type === "DECLARE_AVAILABILITY") {
      const a = asAvailability(op);
      return a ? processAvailability(tx, ctx, op, a) : invalid();
    }
    if (op.type === "RESPOND_EMERGENCY") {
      const r = asRespond(op);
      return r ? processRespond(tx, ctx, op, r) : invalid();
    }
    if (op.type === "ACK_NOTICE") {
      const a = asAck(op);
      return a ? processAck(tx, ctx, op, a) : invalid();
    }
    const t = asToken(op);
    return t ? processToken(tx, ctx, op, t) : invalid();
  });
}

export async function syncPushRoutes(app: FastifyInstance) {
  app.post<{ Body: Body }>(
    "/v1/sync/push",
    { schema: { body: envelopeSchema }, preHandler: guard({ mobileOnly: true }), bodyLimit: 256 * 1024 },
    async (req) => {
      const { userId, deviceId } = req.auth!;
      const receivedAt = new Date();
      const ops = [...req.body.operations].sort((a, b) => a.deviceSeq - b.deviceSeq);

      // Garantía 7: una colisión de deviceSeq no procesa nada.
      const seen = new Map<number, string>();
      for (const op of ops) {
        const prev = seen.get(op.deviceSeq);
        if (prev && prev !== op.operationId) throw new ApiError(409, "DEVICE_SEQ_CONFLICT", "deviceSeq repetido en el lote");
        seen.set(op.deviceSeq, op.operationId);
      }
      const clashes = await prisma.syncOperation.findMany({
        where: { deviceId: deviceId!, deviceSeq: { in: ops.map((o) => BigInt(o.deviceSeq)) } },
        select: { operationId: true, deviceSeq: true },
      });
      for (const c of clashes) {
        if (seen.get(Number(c.deviceSeq)) !== c.operationId) {
          throw new ApiError(409, "DEVICE_SEQ_CONFLICT", "deviceSeq ya usado por otra operación de este dispositivo");
        }
      }

      await prisma.device.update({
        where: { id: deviceId! },
        data: {
          lastSeenAt: receivedAt,
          lastClockOffsetMs: Math.max(-2_000_000_000, Math.min(2_000_000_000, receivedAt.getTime() - Date.parse(req.body.clock.deviceNow))),
        },
      });

      const ctx: Ctx = { userId, deviceId: deviceId!, clock: req.body.clock, receivedAt };
      const results: OperationResult[] = [];
      for (const op of ops) results.push(await processOne(ctx, op));

      const meta = await prisma.syncMetadata.findUniqueOrThrow({ where: { id: 1 } });
      // Mismo orden que el lote recibido.
      const byId = new Map(results.map((r) => [r.operationId, r]));
      return {
        syncEpoch: meta.syncEpoch,
        serverTime: new Date().toISOString(),
        results: req.body.operations.map((o) => byId.get(o.operationId)!),
      };
    },
  );
}

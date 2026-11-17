import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { prisma, replicatedWrite, toNum, type Tx } from "../db.js";
import { guard } from "../auth/guard.js";
import { ApiError } from "../http/problem.js";
import { reach, readiness, type ReachStatus } from "../coordinator/status.js";
import { availabilityOf, type AvailabilityFilter } from "../availability.js";
import type { AppUser, Emergency, EmergencyNotice } from "../generated/prisma/client.js";

const COORD_OR_ADMIN = guard({ webOnly: true, capabilities: ["COORD", "ADMIN"] });
const COORD = guard({ webOnly: true, capabilities: ["COORD"] });

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const userRef = (u: Pick<AppUser, "id" | "fullName">) => ({ id: u.id, fullName: u.fullName });

const header = (e: Emergency) => ({
  id: e.id,
  emergencyType: e.emergencyType,
  meetingPoint: e.meetingPoint,
  scheduledAt: e.scheduledAt.toISOString(),
  status: e.status,
  activatedAt: iso(e.activatedAt),
  closedAt: iso(e.closedAt),
});

type EmergencyFull = Emergency & {
  createdBy: AppUser;
  activatedBy: AppUser | null;
  closedBy: AppUser | null;
  notices: (EmergencyNotice & { createdBy: AppUser })[];
};
const fullInclude = {
  createdBy: true,
  activatedBy: true,
  closedBy: true,
  notices: { include: { createdBy: true }, orderBy: { createdAt: "asc" as const } },
};

const detail = (e: EmergencyFull) => ({
  emergency: {
    ...header(e),
    instructions: e.instructions,
    createdBy: userRef(e.createdBy),
    createdAt: e.createdAt.toISOString(),
    activatedBy: e.activatedBy ? userRef(e.activatedBy) : null,
    closedBy: e.closedBy ? userRef(e.closedBy) : null,
    updatedAt: e.updatedAt.toISOString(),
    rowVersion: toNum(e.rowVersion),
  },
  notices: e.notices.map((n) => ({
    id: n.id,
    kind: n.kind,
    message: n.message,
    createdAt: n.createdAt.toISOString(),
    createdBy: userRef(n.createdBy),
  })),
});

/** ETag del cuerpo (excluye `generatedAt`): 304 si nada cambió. */
function sendWithEtag(req: FastifyRequest, reply: FastifyReply, body: Record<string, unknown>) {
  const { generatedAt: _g, ...stable } = body;
  const etag = `"${createHash("sha256").update(JSON.stringify(stable)).digest("base64url").slice(0, 27)}"`;
  reply.header("ETag", etag).header("Cache-Control", "no-cache");
  if (req.headers["if-none-match"] === etag) return reply.status(304).send();
  return body;
}

/** Operaciones en conflicto o rechazadas sin resolución final. */
async function pendingReviewRecipients(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ recipient_id: string | null }[]>`
    SELECT o.payload->>'recipientId' AS recipient_id
    FROM sync_operation o
    WHERE o.result IN ('CONFLICT', 'REJECTED')
      AND NOT EXISTS (SELECT 1 FROM sync_operation_resolution r WHERE r.operation_id = o.operation_id AND r.action <> 'NOTE')`;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.recipient_id ?? "", (m.get(r.recipient_id ?? "") ?? 0) + 1);
  return m;
}
const totalPending = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** Estado de cada convocado de una convocatoria (llegada separada de respuesta). */
async function recipientStatuses(emergencyId: string) {
  const [recipients, notices, reviews] = await Promise.all([
    prisma.emergencyRecipient.findMany({
      where: { emergencyId },
      include: {
        brigadista: { include: { user: { include: { devices: true } } } },
        currentResponseRef: true,
        acks: true,
        deliveries: true,
      },
    }),
    prisma.emergencyNotice.findMany({ where: { emergencyId }, orderBy: { createdAt: "asc" } }),
    pendingReviewRecipients(),
  ]);
  const activation = notices.find((n) => n.kind === "ACTIVATION");
  return recipients
    .map((r) => {
      const devices = r.brigadista.user.devices;
      const hasValid = devices.some((d) => !d.revokedAt && d.pushTokenStatus === "VALID");
      const noticeReach = notices.map((n) => ({ noticeId: n.id, kind: n.kind, reach: reach(n.id, r.acks, r.deliveries, hasValid) }));
      const ready = readiness(devices);
      return {
        recipientId: r.id,
        brigadista: {
          id: r.brigadista.id,
          fullName: r.brigadista.user.fullName,
          phone: r.brigadista.phone,
          active: r.brigadista.active,
        },
        addedReason: r.addedReason,
        convokedAt: r.convokedAt.toISOString(),
        response: (r.currentResponse ?? "PENDING") as "VOY" | "NO_PUEDO" | "PENDING",
        respondedAt: iso(r.respondedAt),
        lateSyncAfterClose: r.currentResponseRef?.lateSyncAfterClose ?? false,
        reach: (activation ? noticeReach.find((x) => x.noticeId === activation.id)!.reach : "NO_DEVICE") as ReachStatus,
        notices: noticeReach,
        hasPendingReview: reviews.has(r.id),
        lastSeenAt: ready.lastSeenAt,
      };
    })
    .sort((a, b) => a.brigadista.fullName.localeCompare(b.brigadista.fullName, "es"));
}

/** Entregas push en cola para cada dispositivo con token válido (las envía el worker, después del commit). */
async function queueDeliveries(tx: Tx, noticeId: string, emergencyId: string): Promise<number> {
  const recipients = await tx.emergencyRecipient.findMany({
    where: { emergencyId },
    include: { brigadista: { include: { user: { include: { devices: true } } } } },
  });
  let withoutPush = 0;
  const now = new Date();
  const rows: { noticeId: string; recipientId: string; channel: "PUSH"; deviceId: string; nextAttemptAt: Date }[] = [];
  for (const r of recipients) {
    const devices = r.brigadista.user.devices.filter((d) => !d.revokedAt && d.pushTokenStatus === "VALID" && d.pushToken);
    if (devices.length === 0) withoutPush++;
    for (const d of devices) rows.push({ noticeId, recipientId: r.id, channel: "PUSH", deviceId: d.id, nextAttemptAt: now });
  }
  if (rows.length) await tx.notificationDelivery.createMany({ data: rows, skipDuplicates: true });
  return withoutPush;
}

interface CreateBody {
  id: string;
  emergencyType: string;
  meetingPoint: string;
  scheduledAt: string;
  instructions?: string;
}

export async function coordinatorRoutes(app: FastifyInstance) {
  app.get("/v1/dashboard/summary", { preHandler: COORD_OR_ADMIN }, async () => {
    const profiles = await prisma.brigadistaProfile.findMany({
      where: { active: true, user: { active: true } },
      include: { user: { include: { devices: true } } },
    });
    const counts = { active: profiles.length, ready: 0, noDevice: 0, pushInvalid: 0, pushDisabled: 0, notSyncedRecently: 0 };
    const key = { READY: "ready", NO_DEVICE: "noDevice", PUSH_INVALID: "pushInvalid", PUSH_DISABLED: "pushDisabled", NOT_SYNCED_RECENTLY: "notSyncedRecently" } as const;
    for (const p of profiles) counts[key[readiness(p.user.devices).state]]++;
    // Disponibilidad declarada (informativa). `stale` se cuenta aparte y también dentro de su estado.
    const availability = { disponible: 0, noDisponible: 0, enServicio: 0, stale: 0, undeclared: 0 };
    const avKey = { DISPONIBLE: "disponible", NO_DISPONIBLE: "noDisponible", EN_SERVICIO: "enServicio" } as const;
    const now = Date.now();
    for (const p of profiles) {
      const a = availabilityOf(p, now);
      if (a.status === null) availability.undeclared++;
      else availability[avKey[a.status]]++;
      if (a.stale) availability.stale++;
    }
    const active = await prisma.emergency.findFirst({ where: { status: "ACTIVE" } });
    return {
      generatedAt: new Date().toISOString(),
      brigadistas: counts,
      availability,
      activeEmergency: active ? header(active) : null,
      pendingReviews: totalPending(await pendingReviewRecipients()),
    };
  });

  app.get<{ Querystring: { active?: boolean; q?: string; limit?: number; cursor?: string } }>(
    "/v1/brigadistas",
    {
      preHandler: COORD_OR_ADMIN,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            active: { type: "boolean", default: true },
            readiness: { enum: ["READY", "NO_DEVICE", "PUSH_INVALID", "PUSH_DISABLED", "NOT_SYNCED_RECENTLY"] },
            availability: { enum: ["DISPONIBLE", "NO_DISPONIBLE", "EN_SERVICIO", "STALE", "UNDECLARED"] },
            q: { type: "string", minLength: 1, maxLength: 60 },
            cursor: { type: "string", maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
          },
        },
      },
    },
    async (req) => {
      const { active = true, q, limit = 100, cursor } = req.query;
      const wanted = (req.query as { readiness?: string }).readiness;
      const wantedAv = (req.query as { availability?: AvailabilityFilter }).availability;
      const now = Date.now();
      const matchesAv = (a: ReturnType<typeof availabilityOf>) =>
        !wantedAv ||
        (wantedAv === "UNDECLARED" ? a.status === null : wantedAv === "STALE" ? a.stale : a.status === wantedAv);
      const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const profiles = await prisma.brigadistaProfile.findMany({ where: { active }, include: { user: { include: { devices: true } } } });
      let items = profiles
        .map((p) => ({
          id: p.id,
          userId: p.userId,
          fullName: p.user.fullName,
          phone: p.phone,
          active: p.active,
          accountActive: p.user.active,
          readiness: readiness(p.user.devices),
          availability: availabilityOf(p, now),
        }))
        .filter((b) => (!q || fold(b.fullName).startsWith(fold(q))) && (!wanted || b.readiness.state === wanted) && matchesAv(b.availability))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "es") || a.id.localeCompare(b.id));
      // Cursor opaco: posición después del último (nombre, id) entregado.
      if (cursor) {
        const [name, id] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, string];
        items = items.filter((b) => b.fullName.localeCompare(name, "es") > 0 || (b.fullName === name && b.id > id));
      }
      const page = items.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page,
        nextCursor: items.length > limit && last ? Buffer.from(JSON.stringify([last.fullName, last.id])).toString("base64url") : null,
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: number; cursor?: string } }>(
    "/v1/brigadistas/:id/availability-history",
    {
      preHandler: COORD_OR_ADMIN,
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "string", maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async (req) => {
      const { limit = 50, cursor } = req.query;
      const profile = await prisma.brigadistaProfile.findUnique({ where: { id: req.params.id } });
      if (!profile) throw new ApiError(404, "NOT_FOUND", "Brigadista no encontrado");
      // Orden: más reciente primero por hora estimada; desempate por id. Cursor = [estimatedAt, id] del último entregado.
      let after: { estimatedAt: Date; id: string } | null = null;
      if (cursor) {
        try {
          const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, string];
          after = { estimatedAt: new Date(at), id };
        } catch {
          throw new ApiError(400, "VALIDATION_ERROR", "Cursor inválido");
        }
      }
      const rows = await prisma.availabilityChange.findMany({
        where: {
          brigadistaId: profile.id,
          ...(after
            ? { OR: [{ estimatedAt: { lt: after.estimatedAt } }, { estimatedAt: after.estimatedAt, id: { lt: after.id } }] }
            : {}),
        },
        orderBy: [{ estimatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((c) => ({
          id: c.id,
          status: c.status,
          source: c.source,
          estimatedAt: c.estimatedAt.toISOString(),
          receivedAt: c.receivedAt.toISOString(),
          timeConfidence: c.timeConfidence,
          createdOffline: c.createdOffline,
          syncResult: c.syncResult,
          current: c.id === profile.lastAvailabilityChangeId,
        })),
        nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.estimatedAt.toISOString(), last.id])).toString("base64url") : null,
      };
    },
  );

  app.post<{ Body: CreateBody }>(
    "/v1/emergencies",
    {
      preHandler: COORD,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "emergencyType", "meetingPoint", "scheduledAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            emergencyType: { type: "string", minLength: 1, maxLength: 100 },
            meetingPoint: { type: "string", minLength: 1, maxLength: 300 },
            scheduledAt: { type: "string", format: "date-time" },
            instructions: { type: "string", minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const existing = await prisma.emergency.findUnique({ where: { id: b.id }, include: fullInclude });
      if (existing) {
        const same =
          existing.emergencyType === b.emergencyType &&
          existing.meetingPoint === b.meetingPoint &&
          existing.scheduledAt.getTime() === Date.parse(b.scheduledAt) &&
          existing.instructions === (b.instructions ?? null);
        if (!same) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Ese id ya se usó con otro contenido");
        return reply.status(200).header("ETag", `"${existing.rowVersion}"`).send(detail(existing));
      }
      const created = await replicatedWrite(async (tx) => {
        const e = await tx.emergency.create({
          data: {
            id: b.id,
            emergencyType: b.emergencyType,
            meetingPoint: b.meetingPoint,
            scheduledAt: new Date(b.scheduledAt),
            instructions: b.instructions ?? null,
            createdById: req.auth!.userId,
          },
        });
        await tx.auditLog.create({ data: { actorUserId: req.auth!.userId, action: "EMERGENCY_CREATED", entityType: "emergency", entityId: e.id } });
        return tx.emergency.findUniqueOrThrow({ where: { id: e.id }, include: fullInclude });
      });
      return reply.status(201).header("ETag", `"${created.rowVersion}"`).send(detail(created));
    },
  );

  app.post<{ Params: { emergencyId: string } }>(
    "/v1/emergencies/:emergencyId/activate",
    { preHandler: COORD, schema: { params: { type: "object", properties: { emergencyId: { type: "string", format: "uuid" } } } } },
    async (req, reply) => {
      const userId = req.auth!.userId;
      const result = await replicatedWrite(async (tx) => {
        const e = await tx.emergency.findUnique({ where: { id: req.params.emergencyId } });
        if (!e || e.deletedAt) throw new ApiError(404, "NOT_FOUND", "No existe");
        if (e.status === "CLOSED") throw new ApiError(409, "EMERGENCY_CLOSED", "La convocatoria está cerrada");
        const already = e.status === "ACTIVE";
        let withoutPush = 0;
        if (!already) {
          const other = await tx.emergency.findFirst({ where: { status: "ACTIVE" } });
          if (other) throw new ApiError(409, "EMERGENCY_ALREADY_ACTIVE", "Ya hay una convocatoria activa");
          const now = new Date();
          await tx.emergency.update({ where: { id: e.id }, data: { status: "ACTIVE", activatedAt: now, activatedById: userId } });
          // R1: todos los brigadistas activos, sin mirar disponibilidad ni última conexión.
          const profiles = await tx.brigadistaProfile.findMany({ where: { active: true, user: { active: true } } });
          await tx.emergencyRecipient.createMany({
            data: profiles.map((p) => ({ emergencyId: e.id, brigadistaId: p.id, addedReason: "ACTIVATION" as const, convokedAt: now })),
            skipDuplicates: true,
          });
          const notice = await tx.emergencyNotice.create({
            data: { emergencyId: e.id, kind: "ACTIVATION", message: `${e.emergencyType} · ${e.meetingPoint}`, createdById: userId, createdAt: now },
          });
          withoutPush = await queueDeliveries(tx, notice.id, e.id);
          await tx.auditLog.create({ data: { actorUserId: userId, action: "EMERGENCY_ACTIVATED", entityType: "emergency", entityId: e.id, metadata: { recipients: profiles.length } } });
        }
        const full = await tx.emergency.findUniqueOrThrow({ where: { id: e.id }, include: fullInclude });
        const recipientsCount = await tx.emergencyRecipient.count({ where: { emergencyId: e.id } });
        return { full, recipientsCount, withoutPush, already };
      });
      const d = detail(result.full);
      return reply.header("ETag", `"${result.full.rowVersion}"`).send({
        ...d,
        recipientsCount: result.recipientsCount,
        recipientsWithoutPush: result.withoutPush,
        alreadyActive: result.already,
      });
    },
  );

  app.post<{ Params: { emergencyId: string }; Body: { message?: string } | undefined }>(
    "/v1/emergencies/:emergencyId/close",
    {
      preHandler: COORD,
      schema: {
        params: { type: "object", properties: { emergencyId: { type: "string", format: "uuid" } } },
        body: { type: ["object", "null"], additionalProperties: false, properties: { message: { type: "string", minLength: 1, maxLength: 1000 } } },
      },
    },
    async (req, reply) => {
      const userId = req.auth!.userId;
      const full = await replicatedWrite(async (tx) => {
        const e = await tx.emergency.findUnique({ where: { id: req.params.emergencyId } });
        if (!e || e.deletedAt) throw new ApiError(404, "NOT_FOUND", "No existe");
        if (e.status === "DRAFT") throw new ApiError(409, "EMERGENCY_NOT_ACTIVE", "La convocatoria no está activa");
        if (e.status === "ACTIVE") {
          const now = new Date();
          await tx.emergency.update({ where: { id: e.id }, data: { status: "CLOSED", closedAt: now, closedById: userId } });
          const notice = await tx.emergencyNotice.create({
            data: { emergencyId: e.id, kind: "CLOSURE", message: req.body?.message ?? "Convocatoria cerrada", createdById: userId, createdAt: now },
          });
          await queueDeliveries(tx, notice.id, e.id);
          await tx.auditLog.create({ data: { actorUserId: userId, action: "EMERGENCY_CLOSED", entityType: "emergency", entityId: e.id } });
        }
        return tx.emergency.findUniqueOrThrow({ where: { id: e.id }, include: fullInclude });
      });
      return reply.header("ETag", `"${full.rowVersion}"`).send(detail(full));
    },
  );

  app.get("/v1/emergencies/active/summary", { preHandler: COORD_OR_ADMIN }, async (req, reply) => {
    const e = await prisma.emergency.findFirst({ where: { status: "ACTIVE" } });
    const reviews = await pendingReviewRecipients();
    if (!e) {
      return sendWithEtag(req, reply, {
        generatedAt: new Date().toISOString(),
        emergency: null,
        responses: null,
        reach: null,
        pendingWithoutAck: null,
        pendingReviews: totalPending(reviews),
      });
    }
    const items = await recipientStatuses(e.id);
    const reachCounts = { opened: 0, received: 0, providerAccepted: 0, sending: 0, deliveryFailed: 0, noDevice: 0 };
    const rk = { OPENED: "opened", RECEIVED: "received", PROVIDER_ACCEPTED: "providerAccepted", SENDING: "sending", DELIVERY_FAILED: "deliveryFailed", NO_DEVICE: "noDevice" } as const;
    for (const i of items) reachCounts[rk[i.reach]]++;
    return sendWithEtag(req, reply, {
      generatedAt: new Date().toISOString(),
      emergency: header(e),
      responses: {
        total: items.length,
        voy: items.filter((i) => i.response === "VOY").length,
        noPuedo: items.filter((i) => i.response === "NO_PUEDO").length,
        pending: items.filter((i) => i.response === "PENDING").length,
      },
      reach: reachCounts,
      pendingWithoutAck: items.filter((i) => i.response === "PENDING" && i.reach !== "OPENED" && i.reach !== "RECEIVED").length,
      pendingReviews: totalPending(reviews),
    });
  });

  app.get<{ Params: { emergencyId: string } }>(
    "/v1/emergencies/:emergencyId",
    { preHandler: COORD_OR_ADMIN, schema: { params: { type: "object", properties: { emergencyId: { type: "string", format: "uuid" } } } } },
    async (req, reply) => {
      const e = await prisma.emergency.findUnique({ where: { id: req.params.emergencyId }, include: fullInclude });
      if (!e || e.deletedAt) throw new ApiError(404, "NOT_FOUND", "No existe");
      return reply.header("ETag", `"${e.rowVersion}"`).send(detail(e));
    },
  );

  app.get<{ Params: { emergencyId: string } }>(
    "/v1/emergencies/:emergencyId/recipients",
    { preHandler: COORD_OR_ADMIN, schema: { params: { type: "object", properties: { emergencyId: { type: "string", format: "uuid" } } } } },
    async (req, reply) => {
      const e = await prisma.emergency.findUnique({ where: { id: req.params.emergencyId } });
      if (!e || e.deletedAt || e.status === "DRAFT") throw new ApiError(404, "NOT_FOUND", "No existe");
      return sendWithEtag(req, reply, { emergency: header(e), generatedAt: new Date().toISOString(), items: await recipientStatuses(e.id) });
    },
  );
}

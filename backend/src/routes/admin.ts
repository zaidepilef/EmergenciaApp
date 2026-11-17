// Administración de cuentas, roles y condición de brigadista (contrato v1,
// tag `admin`). Solo sesión WEB con capacidad ADMIN.
import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import { parseRut } from "@emergencia/shared/rut";
import { prisma, replicatedWrite, type Tx } from "../db.js";
import { guard } from "../auth/guard.js";
import { hashPassword } from "../auth/password.js";
import { ApiError } from "../http/problem.js";
import type { AppRole, Prisma } from "../generated/prisma/client.js";

const ADMIN = guard({ webOnly: true, capabilities: ["ADMIN"] });
const PROVISIONAL_TTL_MS = 72 * 3600_000;
const ROLES = ["ADMINISTRADOR", "COORDINADOR"] as const;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ─────────────── Esquemas de entrada ───────────────

const uuid = { type: "string", format: "uuid" } as const;
const personName = { type: "string", minLength: 1, maxLength: 120 } as const;
const email = { type: "string", format: "email", maxLength: 254 } as const;
const phone = { type: "string", pattern: "^\\+?[0-9 ]{8,20}$" } as const;
const reasonBody = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1, maxLength: 300 } },
} as const;
const profileBody = {
  type: "object",
  additionalProperties: false,
  properties: { phone: { oneOf: [phone, { type: "null" }] } },
} as const;
const userIdParams = { type: "object", required: ["userId"], properties: { userId: uuid } } as const;

// ─────────────── Vistas ───────────────

const userInclude = { roles: true, brigadistaProfile: true, devices: { orderBy: { createdAt: "desc" as const } } } satisfies Prisma.AppUserInclude;
type UserFull = Prisma.AppUserGetPayload<{ include: typeof userInclude }>;

function summary(u: UserFull) {
  const p = u.brigadistaProfile;
  return {
    id: u.id,
    rut: u.rut,
    fullName: u.fullName,
    email: u.email,
    active: u.active,
    roles: u.roles.map((r) => r.role).sort(),
    brigadista: p ? { id: p.id, active: p.active, phone: p.phone, joinedAt: p.joinedAt.toISOString(), leftAt: iso(p.leftAt) } : null,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

function detail(u: UserFull, currentDeviceId: string | null) {
  return {
    ...summary(u),
    passwordExpiresAt: iso(u.passwordExpiresAt),
    deactivatedAt: iso(u.deactivatedAt),
    devices: u.devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      appVersion: d.appVersion,
      osVersion: d.osVersion,
      pushStatus: d.pushTokenStatus === "VALID" ? "VALID" : d.pushTokenStatus === "INVALID" ? "INVALID" : "NONE",
      lastSeenAt: iso(d.lastSeenAt),
      createdAt: d.createdAt.toISOString(),
      revokedAt: iso(d.revokedAt),
      current: d.id === currentDeviceId,
    })),
  };
}

async function loadUser(tx: Tx | typeof prisma, userId: string): Promise<UserFull> {
  const u = await tx.appUser.findUnique({ where: { id: userId }, include: userInclude });
  if (!u) throw new ApiError(404, "NOT_FOUND", "Cuenta no encontrada");
  return u;
}

// ─────────────── Reglas compartidas ───────────────

/** Contraseña provisoria legible (sin 0/O, 1/l/I): 3 bloques de 4, ~68 bits. */
function provisionalPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const block = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}

async function audit(tx: Tx, actorUserId: string, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await tx.auditLog.create({ data: { actorUserId, action, entityType: "app_user", entityId, metadata: metadata as Prisma.InputJsonValue } });
}

async function revokeSessions(tx: Tx, userId: string, reason: "PASSWORD_RESET" | "ACCOUNT_DEACTIVATED", now: Date) {
  await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
}

/** ¿Quitar a este usuario deja sin administradores activos? */
async function isLastActiveAdmin(tx: Tx, userId: string): Promise<boolean> {
  const others = await tx.userRole.count({
    where: { role: "ADMINISTRADOR", userId: { not: userId }, user: { active: true } },
  });
  return others === 0;
}

/**
 * Convocatoria automática a la convocatoria activa (LATE_ADDITION) de un
 * brigadista recién activo. Si ya figuraba y no ha respondido, re-arma sus
 * entregas de los avisos que no acusó. Nunca crea un segundo convocado.
 */
async function joinActiveEmergency(tx: Tx, userId: string, actorId: string, now: Date) {
  const user = await tx.appUser.findUniqueOrThrow({ where: { id: userId }, include: { brigadistaProfile: true, devices: true } });
  const profile = user.brigadistaProfile;
  if (!user.active || !profile?.active) return null;
  const emergency = await tx.emergency.findFirst({ where: { status: "ACTIVE" }, include: { notices: true } });
  if (!emergency) return null;

  let recipient = await tx.emergencyRecipient.findFirst({
    where: { emergencyId: emergency.id, brigadistaId: profile.id },
    include: { acks: true },
  });
  let added = false;
  if (!recipient) {
    recipient = await tx.emergencyRecipient.create({
      data: { emergencyId: emergency.id, brigadistaId: profile.id, addedReason: "LATE_ADDITION", addedById: actorId, convokedAt: now },
      include: { acks: true },
    });
    added = true;
  } else if (recipient.currentResponse) {
    return null; // ya respondió: no se le vuelve a avisar
  }

  // Avisos no acusados × dispositivos con token válido: una entrega por aviso y dispositivo.
  const devices = user.devices.filter((d) => !d.revokedAt && d.pushTokenStatus === "VALID" && d.pushToken);
  const acked = new Set(recipient.acks.map((a) => a.noticeId));
  const notices = emergency.notices.filter((n) => n.kind !== "CLOSURE" && !acked.has(n.id));
  let rearmed: { id: string; status: string; attempts: number; lastErrorCode: string | null }[] = [];
  if (!added && notices.length) {
    const where = { recipientId: recipient.id, noticeId: { in: notices.map((n) => n.id) }, status: { not: "QUEUED" as const } };
    // El estado anterior queda en auditoría antes de re-armar.
    rearmed = await tx.notificationDelivery.findMany({ where, select: { id: true, status: true, attempts: true, lastErrorCode: true } });
    await tx.notificationDelivery.updateMany({
      where,
      data: {
        status: "QUEUED",
        attempts: 0,
        nextAttemptAt: now,
        sentAt: null,
        providerAcceptedAt: null,
        providerDeliveredAt: null,
        failedAt: null,
        lastErrorCode: null,
        updatedAt: now,
      },
    });
  }
  const rows = notices.flatMap((n) =>
    devices.map((d) => ({ noticeId: n.id, recipientId: recipient!.id, channel: "PUSH" as const, deviceId: d.id, nextAttemptAt: now })),
  );
  if (rows.length) await tx.notificationDelivery.createMany({ data: rows, skipDuplicates: true });
  await tx.auditLog.create({
    data: {
      actorUserId: actorId,
      action: added ? "RECIPIENT_LATE_ADDED" : "RECIPIENT_DELIVERIES_REARMED",
      entityType: "emergency_recipient",
      entityId: recipient.id,
      metadata: { emergencyId: emergency.id, notices: notices.length, devices: devices.length, previousDeliveries: rearmed },
    },
  });
  return added ? { emergencyId: emergency.id, recipientId: recipient.id } : null;
}

/** Errores de unicidad de Prisma → códigos del contrato. */
function uniqueViolation(e: unknown): never {
  const target = JSON.stringify((e as { meta?: unknown })?.meta ?? "");
  if ((e as { code?: string })?.code === "P2002") {
    if (target.includes("email")) throw new ApiError(409, "EMAIL_ALREADY_EXISTS", "Ese correo ya está registrado");
    if (target.includes("rut")) throw new ApiError(409, "RUT_ALREADY_EXISTS", "Ese RUT ya está registrado");
  }
  throw e;
}

// ─────────────── Rutas ───────────────

interface CreateBody {
  rut: string;
  fullName: string;
  email?: string;
  roles: AppRole[];
  brigadista: { phone?: string | null } | null;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { active?: boolean; role?: AppRole; q?: string; limit?: number; cursor?: string } }>(
    "/v1/users",
    {
      preHandler: ADMIN,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            active: { type: "boolean" },
            role: { enum: ROLES },
            q: { type: "string", minLength: 1, maxLength: 60 },
            cursor: { type: "string", maxLength: 512 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async (req) => {
      const { active, role, q, limit = 50, cursor } = req.query;
      const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const rutQuery = q ? q.replace(/[.\s-]/g, "").toUpperCase() : null;
      const users = await prisma.appUser.findMany({
        where: { ...(active === undefined ? {} : { active }), ...(role ? { roles: { some: { role } } } : {}) },
        include: userInclude,
      });
      let items = users
        .filter((u) => !q || fold(u.fullName).startsWith(fold(q)) || fold(u.fullName).includes(" " + fold(q)) || u.rut.replace("-", "").startsWith(rutQuery!))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "es") || a.id.localeCompare(b.id));
      if (cursor) {
        let after: [string, string];
        try {
          after = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, string];
        } catch {
          throw new ApiError(400, "VALIDATION_ERROR", "Cursor inválido");
        }
        items = items.filter((u) => u.fullName.localeCompare(after[0], "es") > 0 || (u.fullName === after[0] && u.id > after[1]));
      }
      const page = items.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(summary),
        nextCursor: items.length > limit && last ? Buffer.from(JSON.stringify([last.fullName, last.id])).toString("base64url") : null,
      };
    },
  );

  app.post<{ Body: CreateBody }>(
    "/v1/users",
    {
      preHandler: ADMIN,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["rut", "fullName", "roles", "brigadista"],
          properties: {
            rut: { type: "string", minLength: 1, maxLength: 20 },
            fullName: personName,
            email,
            roles: { type: "array", uniqueItems: true, items: { enum: ROLES } },
            brigadista: { oneOf: [profileBody, { type: "null" }] },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = req.auth!.userId;
      const parsed = parseRut(req.body.rut);
      if (!parsed.ok) {
        throw new ApiError(400, "VALIDATION_ERROR", "RUT inválido", [
          { field: "/rut", code: parsed.error === "RUT_INVALID_VERIFIER" ? "RUT_INVALID_VERIFIER" : "RUT_INVALID_FORMAT" },
        ]);
      }
      const password = provisionalPassword();
      const passwordHash = await hashPassword(password);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + PROVISIONAL_TTL_MS);
      const { user, addition } = await replicatedWrite(async (tx) => {
        let created;
        try {
          created = await tx.appUser.create({
            data: {
              rut: parsed.rut,
              fullName: req.body.fullName.trim(),
              email: req.body.email?.trim().toLowerCase() ?? null,
              passwordHash,
              mustChangePassword: true,
              passwordExpiresAt: expiresAt,
            },
          });
        } catch (e) {
          uniqueViolation(e);
        }
        if (req.body.roles.length) {
          await tx.userRole.createMany({ data: req.body.roles.map((role) => ({ userId: created.id, role, grantedById: actor, grantedAt: now })) });
        }
        if (req.body.brigadista) {
          await tx.brigadistaProfile.create({
            data: { userId: created.id, phone: req.body.brigadista.phone ?? null, availabilityDeclaredAt: now, joinedAt: now },
          });
        }
        await audit(tx, actor, "USER_CREATED", created.id, { roles: req.body.roles, brigadista: !!req.body.brigadista });
        const addition = await joinActiveEmergency(tx, created.id, actor, now);
        return { user: await loadUser(tx, created.id), addition };
      });
      reply.status(201).header("Cache-Control", "no-store");
      return {
        user: detail(user, null),
        provisionalPassword: { provisionalPassword: password, expiresAt: expiresAt.toISOString() },
        addedToActiveEmergency: addition,
      };
    },
  );

  app.get<{ Params: { userId: string } }>("/v1/users/:userId", { preHandler: ADMIN, schema: { params: userIdParams } }, async (req) =>
    detail(await loadUser(prisma, req.params.userId), null),
  );

  app.patch<{ Params: { userId: string }; Body: { fullName?: string; email?: string | null } }>(
    "/v1/users/:userId",
    {
      preHandler: ADMIN,
      schema: {
        params: userIdParams,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: { fullName: personName, email: { oneOf: [email, { type: "null" }] } },
        },
      },
    },
    async (req) => {
      const { userId } = req.params;
      const user = await replicatedWrite(async (tx) => {
        await loadUser(tx, userId);
        const data: Prisma.AppUserUpdateInput = { updatedAt: new Date() };
        if (req.body.fullName !== undefined) data.fullName = req.body.fullName.trim();
        if (req.body.email !== undefined) data.email = req.body.email === null ? null : req.body.email.trim().toLowerCase();
        try {
          await tx.appUser.update({ where: { id: userId }, data });
        } catch (e) {
          uniqueViolation(e);
        }
        await audit(tx, req.auth!.userId, "USER_UPDATED", userId, { fields: Object.keys(req.body) });
        return loadUser(tx, userId);
      });
      return detail(user, null);
    },
  );

  app.post<{ Params: { userId: string }; Body: { reason: string } }>(
    "/v1/users/:userId/deactivate",
    { preHandler: ADMIN, schema: { params: userIdParams, body: reasonBody } },
    async (req) => {
      const { userId } = req.params;
      const actor = req.auth!.userId;
      if (userId === actor) throw new ApiError(409, "CANNOT_DEACTIVATE_SELF", "No puedes desactivar tu propia cuenta");
      const user = await replicatedWrite(async (tx) => {
        const u = await loadUser(tx, userId);
        if (!u.active) return u; // idempotente
        if (u.roles.some((r) => r.role === "ADMINISTRADOR") && (await isLastActiveAdmin(tx, userId))) {
          throw new ApiError(409, "LAST_ADMIN", "Es el último administrador activo");
        }
        const now = new Date();
        await tx.appUser.update({
          where: { id: userId },
          data: { active: false, deactivatedAt: now, deactivatedById: actor, credentialVersion: { increment: 1 }, updatedAt: now },
        });
        await revokeSessions(tx, userId, "ACCOUNT_DEACTIVATED", now);
        await audit(tx, actor, "USER_DEACTIVATED", userId, { reason: req.body.reason });
        return loadUser(tx, userId);
      });
      return detail(user, null);
    },
  );

  app.post<{ Params: { userId: string } }>("/v1/users/:userId/activate", { preHandler: ADMIN, schema: { params: userIdParams } }, async (req) => {
    const { userId } = req.params;
    const actor = req.auth!.userId;
    return replicatedWrite(async (tx) => {
      const u = await loadUser(tx, userId);
      const now = new Date();
      if (!u.active) {
        await tx.appUser.update({ where: { id: userId }, data: { active: true, deactivatedAt: null, deactivatedById: null, updatedAt: now } });
        await audit(tx, actor, "USER_ACTIVATED", userId);
      }
      const addition = u.active ? null : await joinActiveEmergency(tx, userId, actor, now);
      return { user: detail(await loadUser(tx, userId), null), addedToActiveEmergency: addition };
    });
  });

  app.post<{ Params: { userId: string } }>(
    "/v1/users/:userId/reset-password",
    { preHandler: ADMIN, schema: { params: userIdParams } },
    async (req, reply) => {
      const { userId } = req.params;
      const password = provisionalPassword();
      const passwordHash = await hashPassword(password);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + PROVISIONAL_TTL_MS);
      await replicatedWrite(async (tx) => {
        const u = await loadUser(tx, userId);
        if (!u.active) throw new ApiError(409, "USER_INACTIVE", "La cuenta está desactivada; reactívala primero");
        await tx.appUser.update({
          where: { id: userId },
          data: { passwordHash, mustChangePassword: true, passwordExpiresAt: expiresAt, credentialVersion: { increment: 1 }, updatedAt: now },
        });
        await revokeSessions(tx, userId, "PASSWORD_RESET", now);
        await audit(tx, req.auth!.userId, "PASSWORD_RESET", userId);
      });
      reply.header("Cache-Control", "no-store");
      return { provisionalPassword: password, expiresAt: expiresAt.toISOString() };
    },
  );

  const roleParams = { type: "object", required: ["userId", "role"], properties: { userId: uuid, role: { enum: ROLES } } } as const;

  app.put<{ Params: { userId: string; role: AppRole } }>(
    "/v1/users/:userId/roles/:role",
    { preHandler: ADMIN, schema: { params: roleParams } },
    async (req) => {
      const { userId, role } = req.params;
      const user = await replicatedWrite(async (tx) => {
        const u = await loadUser(tx, userId);
        if (!u.roles.some((r) => r.role === role)) {
          await tx.userRole.create({ data: { userId, role, grantedById: req.auth!.userId } });
          await tx.appUser.update({ where: { id: userId }, data: { updatedAt: new Date() } });
          await audit(tx, req.auth!.userId, "ROLE_GRANTED", userId, { role });
        }
        return loadUser(tx, userId);
      });
      return detail(user, null);
    },
  );

  app.delete<{ Params: { userId: string; role: AppRole } }>(
    "/v1/users/:userId/roles/:role",
    { preHandler: ADMIN, schema: { params: roleParams } },
    async (req) => {
      const { userId, role } = req.params;
      const user = await replicatedWrite(async (tx) => {
        const u = await loadUser(tx, userId);
        if (u.roles.some((r) => r.role === role)) {
          if (role === "ADMINISTRADOR" && u.active && (await isLastActiveAdmin(tx, userId))) {
            throw new ApiError(409, "LAST_ADMIN", "Es el último administrador activo");
          }
          await tx.userRole.delete({ where: { userId_role: { userId, role } } });
          await tx.appUser.update({ where: { id: userId }, data: { updatedAt: new Date() } });
          await audit(tx, req.auth!.userId, "ROLE_REVOKED", userId, { role });
        }
        return loadUser(tx, userId);
      });
      return detail(user, null);
    },
  );

  app.put<{ Params: { userId: string }; Body: { phone?: string | null } }>(
    "/v1/users/:userId/brigadista-profile",
    { preHandler: ADMIN, schema: { params: userIdParams, body: profileBody } },
    async (req) => {
      const { userId } = req.params;
      const actor = req.auth!.userId;
      return replicatedWrite(async (tx) => {
        const u = await loadUser(tx, userId);
        const now = new Date();
        const p = u.brigadistaProfile;
        const phone = req.body.phone === undefined ? (p?.phone ?? null) : req.body.phone;
        let becameActive = false;
        if (!p) {
          await tx.brigadistaProfile.create({ data: { userId, phone, availabilityDeclaredAt: now, joinedAt: now } });
          becameActive = true;
        } else {
          becameActive = !p.active;
          await tx.brigadistaProfile.update({
            where: { id: p.id },
            data: { phone, active: true, leftAt: null, ...(becameActive ? { joinedAt: now } : {}), updatedAt: now },
          });
        }
        await audit(tx, actor, becameActive ? "BRIGADISTA_ACTIVATED" : "BRIGADISTA_UPDATED", userId, { phoneChanged: phone !== (p?.phone ?? null) });
        // Solo cambiar el teléfono nunca convoca ni notifica.
        const addition = becameActive ? await joinActiveEmergency(tx, userId, actor, now) : null;
        return { user: detail(await loadUser(tx, userId), null), addedToActiveEmergency: addition };
      });
    },
  );

  app.post<{ Params: { userId: string }; Body: { reason: string } }>(
    "/v1/users/:userId/brigadista-profile/deactivate",
    { preHandler: ADMIN, schema: { params: userIdParams, body: reasonBody } },
    async (req) => {
      const { userId } = req.params;
      const user = await replicatedWrite(async (tx) => {
        const u = await loadUser(tx, userId);
        const p = u.brigadistaProfile;
        if (p?.active) {
          const now = new Date();
          await tx.brigadistaProfile.update({ where: { id: p.id }, data: { active: false, leftAt: now, updatedAt: now } });
          await audit(tx, req.auth!.userId, "BRIGADISTA_DEACTIVATED", userId, { reason: req.body.reason });
        }
        return loadUser(tx, userId);
      });
      return detail(user, null);
    },
  );
}

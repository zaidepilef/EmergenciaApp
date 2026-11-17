import type { FastifyInstance } from "fastify";
import { parseRut } from "@emergencia/shared/rut";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../http/problem.js";
import { dummyHash, hashPassword, verifyPassword } from "../auth/password.js";
import { newRefreshToken, sha256, signAccessToken } from "../auth/tokens.js";
import { guard } from "../auth/guard.js";
import { uuidv7 } from "../ids.js";
import { buildMe } from "./me.js";

const uuid = { type: "string", format: "uuid" } as const;
const password = { type: "string", minLength: 1, maxLength: 128 } as const;
const rut = { type: "string", minLength: 1, maxLength: 20 } as const;

const loginSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["clientType", "rut", "password", "device"],
      properties: {
        clientType: { const: "MOBILE" },
        rut,
        password,
        device: {
          type: "object",
          additionalProperties: false,
          required: ["id", "platform"],
          properties: {
            id: uuid,
            platform: { enum: ["ANDROID", "IOS"] },
            appVersion: { type: "string", maxLength: 32 },
            osVersion: { type: "string", maxLength: 32 },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["clientType", "rut", "password"],
      properties: { clientType: { const: "WEB" }, rut, password },
    },
  ],
} as const;

type LoginBody =
  | {
      clientType: "MOBILE";
      rut: string;
      password: string;
      device: { id: string; platform: "ANDROID" | "IOS"; appVersion?: string; osVersion?: string };
    }
  | { clientType: "WEB"; rut: string; password: string };

type Scope = "FULL" | "PASSWORD_CHANGE_ONLY";

async function issueTokens(
  sessionId: string,
  userId: string,
  cv: number,
  scope: Scope,
  refreshToken: string,
  refreshExpiresAt: Date,
) {
  const access = await signAccessToken({ sub: userId, sid: sessionId, cv, scope });
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    sessionScope: scope,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>("/v1/auth/login", { schema: { body: loginSchema } }, async (req, reply) => {
    const body = req.body;
    const parsed = parseRut(body.rut);
    if (!parsed.ok) {
      throw new ApiError(400, "VALIDATION_ERROR", "RUT inválido", [
        { field: "/rut", code: parsed.error === "RUT_INVALID_VERIFIER" ? "RUT_INVALID_VERIFIER" : "RUT_INVALID_FORMAT" },
      ]);
    }

    // Mismo trabajo (un argon2) exista o no el RUT.
    const user = await prisma.appUser.findUnique({ where: { rut: parsed.rut } });
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), body.password);
    const now = new Date();
    if (!user || !ok || !user.active || (user.passwordExpiresAt && user.passwordExpiresAt <= now)) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "RUT o contraseña incorrectos");
    }

    const scope: Scope = user.mustChangePassword ? "PASSWORD_CHANGE_ONLY" : "FULL";
    const refreshToken = newRefreshToken();
    const ttl = body.clientType === "MOBILE" ? config.refreshTtlMobileSec : config.refreshTtlWebSec;
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const session = await prisma.$transaction(async (tx) => {
      let deviceId: string | null = null;
      if (body.clientType === "MOBILE") {
        const d = body.device;
        const existing = await tx.device.findUnique({ where: { id: d.id } });
        if (existing && existing.userId !== user.id) {
          throw new ApiError(409, "DEVICE_ID_CONFLICT", "El dispositivo pertenece a otra cuenta");
        }
        if (existing?.revokedAt) throw new ApiError(403, "DEVICE_REVOKED", "Dispositivo revocado");
        const fields = {
          platform: d.platform,
          appVersion: d.appVersion ?? null,
          osVersion: d.osVersion ?? null,
          lastSeenAt: now,
        };
        await tx.device.upsert({
          where: { id: d.id },
          create: { id: d.id, userId: user.id, ...fields },
          update: fields,
        });
        deviceId = d.id;
      }
      await tx.appUser.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      return tx.authSession.create({
        data: {
          userId: user.id,
          familyId: uuidv7(),
          clientType: body.clientType,
          deviceId,
          scope,
          credentialVersion: user.credentialVersion,
          refreshTokenHash: sha256(refreshToken),
          expiresAt,
        },
      });
    });

    reply.header("Cache-Control", "no-store");
    return {
      tokens: await issueTokens(session.id, user.id, user.credentialVersion, scope, refreshToken, expiresAt),
      me: await buildMe(user.id, session.id),
    };
  });

  app.post<{ Body: { refreshToken: string } }>(
    "/v1/auth/refresh",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string", minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "Sesión inválida o vencida");
      const now = new Date();
      const result = await prisma.$transaction(async (tx) => {
        const s = await tx.authSession.findUnique({
          where: { refreshTokenHash: sha256(req.body.refreshToken) },
          include: { user: true },
        });
        if (!s) throw unauthenticated();
        if (s.revokedAt) {
          if (s.revokedReason !== "ROTATED") throw unauthenticated();
          if (now.getTime() - s.revokedAt.getTime() <= config.refreshRaceWindowMs) {
            throw new ApiError(409, "REFRESH_RACE", "Token ya renovado; usar el más nuevo");
          }
          await tx.authSession.updateMany({
            where: { familyId: s.familyId, revokedAt: null },
            data: { revokedAt: now, revokedReason: "REUSE_DETECTED" },
          });
          return null; // se confirma la revocación y después se responde 401
        }
        if (s.expiresAt <= now || !s.user.active || s.user.credentialVersion !== s.credentialVersion) {
          throw unauthenticated();
        }
        const refreshToken = newRefreshToken();
        const next = await tx.authSession.create({
          data: {
            userId: s.userId,
            familyId: s.familyId,
            clientType: s.clientType,
            deviceId: s.deviceId,
            scope: s.scope,
            credentialVersion: s.credentialVersion,
            refreshTokenHash: sha256(refreshToken),
            expiresAt: s.expiresAt,
          },
        });
        await tx.authSession.update({
          where: { id: s.id },
          data: { revokedAt: now, revokedReason: "ROTATED", replacedById: next.id, lastUsedAt: now },
        });
        return { next, refreshToken };
      });
      if (!result) throw unauthenticated();
      reply.header("Cache-Control", "no-store");
      const { next, refreshToken } = result;
      return issueTokens(next.id, next.userId, next.credentialVersion, next.scope, refreshToken, next.expiresAt);
    },
  );

  app.post("/v1/auth/logout", { preHandler: guard({ scope: "ANY" }) }, async (req, reply) => {
    const { sessionId, deviceId } = req.auth!;
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now, revokedReason: "LOGOUT" },
      });
      // C2: un teléfono del que el usuario salió deja de sonar.
      if (deviceId) {
        await tx.device.update({
          where: { id: deviceId },
          data: { pushToken: null, pushTokenStatus: null, pushTokenUpdatedAt: now },
        });
      }
    });
    return reply.status(204).send();
  });

  /**
   * Cambio de contraseña propia (obligatorio con provisoria). En una transacción:
   * hash nuevo, fin de la provisoria, credential_version + 1, revocación de todas
   * las sesiones y una sesión FULL nueva para el mismo cliente y dispositivo.
   */
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/v1/auth/password",
    {
      preHandler: guard({ scope: "ANY" }),
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 128 },
            newPassword: { type: "string", minLength: 10, maxLength: 128 },
          },
        },
      },
    },
    async (req, reply) => {
      const { userId, sessionId } = req.auth!;
      if (!passwordChangeAllowed(userId)) throw new ApiError(429, "RATE_LIMITED", "Demasiados intentos; espera unos minutos");
      const { currentPassword, newPassword } = req.body;
      const user = await prisma.appUser.findUniqueOrThrow({ where: { id: userId } });
      if (!(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new ApiError(422, "CURRENT_PASSWORD_INVALID", "La contraseña actual no corresponde");
      }
      const rutBody = user.rut.split("-")[0]!;
      if (newPassword.replace(/[.\-\s]/g, "").includes(rutBody)) {
        throw new ApiError(422, "PASSWORD_POLICY", "La contraseña no puede contener tu RUT", [{ field: "/newPassword", code: "PASSWORD_CONTAINS_RUT" }]);
      }
      if (await verifyPassword(user.passwordHash, newPassword)) {
        throw new ApiError(422, "PASSWORD_REUSED", "La contraseña nueva debe ser distinta de la actual");
      }

      const current = await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } });
      const hash = await hashPassword(newPassword);
      const now = new Date();
      const refreshToken = newRefreshToken();
      const ttl = current.clientType === "MOBILE" ? config.refreshTtlMobileSec : config.refreshTtlWebSec;
      const expiresAt = new Date(now.getTime() + ttl * 1000);
      const { session, cv } = await prisma.$transaction(async (tx) => {
        const updated = await tx.appUser.update({
          where: { id: userId },
          data: {
            passwordHash: hash,
            mustChangePassword: false,
            passwordExpiresAt: null,
            passwordChangedAt: now,
            credentialVersion: { increment: 1 },
            updatedAt: now,
          },
        });
        await tx.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now, revokedReason: "PASSWORD_CHANGED" },
        });
        const session = await tx.authSession.create({
          data: {
            userId,
            familyId: uuidv7(),
            clientType: current.clientType,
            deviceId: current.deviceId,
            scope: "FULL",
            credentialVersion: updated.credentialVersion,
            refreshTokenHash: sha256(refreshToken),
            expiresAt,
          },
        });
        await tx.auditLog.create({
          data: { actorUserId: userId, action: "PASSWORD_CHANGED", entityType: "app_user", entityId: userId, metadata: { clientType: current.clientType } },
        });
        return { session, cv: updated.credentialVersion };
      });
      reply.header("Cache-Control", "no-store");
      return {
        tokens: await issueTokens(session.id, userId, cv, "FULL", refreshToken, expiresAt),
        me: await buildMe(userId, session.id),
      };
    },
  );
}

/** Límite simple en memoria: 5 cambios de contraseña por usuario cada 15 min (una instancia). */
const passwordAttempts = new Map<string, number[]>();
function passwordChangeAllowed(userId: string): boolean {
  const now = Date.now();
  const recent = (passwordAttempts.get(userId) ?? []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 5) return false;
  recent.push(now);
  passwordAttempts.set(userId, recent);
  return true;
}

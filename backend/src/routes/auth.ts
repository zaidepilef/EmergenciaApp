import type { FastifyInstance } from "fastify";
import { parseRut } from "@emergencia/shared/rut";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../http/problem.js";
import { dummyHash, verifyPassword } from "../auth/password.js";
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
}

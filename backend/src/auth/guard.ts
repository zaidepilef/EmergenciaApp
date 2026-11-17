import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { ApiError } from "../http/problem.js";
import { verifyAccessToken } from "./tokens.js";

export type Capability = "ADMIN" | "COORD" | "BRIG";

export interface AuthContext {
  userId: string;
  sessionId: string;
  scope: "FULL" | "PASSWORD_CHANGE_ONLY";
  clientType: "MOBILE" | "WEB";
  deviceId: string | null;
  capabilities: Capability[];
  brigadistaId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

interface GuardOptions {
  /** ANY acepta también PASSWORD_CHANGE_ONLY. */
  scope?: "FULL" | "ANY";
  mobileOnly?: boolean;
  /** Rutas del dashboard (`x-client: [WEB]`). */
  webOnly?: boolean;
  capabilities?: Capability[];
}

/**
 * Autenticación por petición. Roles, estado de la cuenta y de la sesión se
 * releen siempre de la base (el token no lleva rol).
 */
export function guard(opts: GuardOptions = {}) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const claims = header?.startsWith("Bearer ") ? await verifyAccessToken(header.slice(7)) : null;
    if (!claims) throw new ApiError(401, "UNAUTHENTICATED", "Sesión inválida o vencida");

    const session = await prisma.authSession.findUnique({
      where: { id: claims.sid },
      include: {
        user: { include: { roles: true, brigadistaProfile: true } },
        device: true,
      },
    });
    const now = new Date();
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !session.user.active ||
      session.user.credentialVersion !== claims.cv
    ) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sesión inválida o vencida");
    }
    if (session.device?.revokedAt) throw new ApiError(403, "DEVICE_REVOKED", "Dispositivo revocado");

    const capabilities: Capability[] = [];
    for (const r of session.user.roles) capabilities.push(r.role === "ADMINISTRADOR" ? "ADMIN" : "COORD");
    if (session.user.brigadistaProfile?.active) capabilities.push("BRIG");

    if ((opts.scope ?? "FULL") === "FULL" && session.scope !== "FULL") {
      throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Debe cambiar su contraseña");
    }
    if (opts.mobileOnly && session.clientType !== "MOBILE") {
      throw new ApiError(403, "MOBILE_SESSION_REQUIRED", "Ruta solo para la app móvil");
    }
    if (opts.webOnly && session.clientType !== "WEB") {
      throw new ApiError(403, "FORBIDDEN", "Ruta solo para el dashboard web");
    }
    if (opts.capabilities && !opts.capabilities.some((c) => capabilities.includes(c))) {
      throw new ApiError(403, "FORBIDDEN", "Sin permiso");
    }

    req.auth = {
      userId: session.userId,
      sessionId: session.id,
      scope: session.scope,
      clientType: session.clientType,
      deviceId: session.deviceId,
      capabilities,
      brigadistaId: session.user.brigadistaProfile?.id ?? null,
    };
  };
}

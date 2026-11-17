import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { guard, type Capability } from "../auth/guard.js";
import { availabilityOf } from "../availability.js";

/** Esquema `Me` del contrato: sin RUT. */
export async function buildMe(userId: string, sessionId: string) {
  const s = await prisma.authSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { user: { include: { roles: true, brigadistaProfile: true } } },
  });
  const u = s.user;
  if (u.id !== userId) throw new Error("session/user mismatch");
  const roles = u.roles.map((r) => r.role);
  const capabilities: Capability[] = roles.map((r) => (r === "ADMINISTRADOR" ? "ADMIN" : "COORD"));
  if (u.brigadistaProfile?.active) capabilities.push("BRIG");
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    roles,
    capabilities,
    mustChangePassword: u.mustChangePassword,
    passwordExpiresAt: u.passwordExpiresAt?.toISOString() ?? null,
    session: { id: s.id, scope: s.scope, clientType: s.clientType, deviceId: s.deviceId },
    brigadista: u.brigadistaProfile
      ? { id: u.brigadistaProfile.id, active: u.brigadistaProfile.active, availability: availabilityOf(u.brigadistaProfile) }
      : null,
    serverTime: new Date().toISOString(),
  };
}

export async function meRoutes(app: FastifyInstance) {
  app.get("/v1/me", { preHandler: guard({ scope: "ANY" }) }, async (req) =>
    buildMe(req.auth!.userId, req.auth!.sessionId),
  );
}

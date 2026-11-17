import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { guard } from "../auth/guard.js";
import { syncEmergency, syncNotice, syncRecipient } from "../sync/serialize.js";

export async function brigadistaRoutes(app: FastifyInstance) {
  // Respaldo del push: la app la consulta al abrirse y al recuperar conexión.
  app.get(
    "/v1/me/active-emergency",
    { preHandler: guard({ mobileOnly: true, capabilities: ["BRIG"] }) },
    async (req, reply) => {
      const emergency = await prisma.emergency.findFirst({ where: { status: "ACTIVE" } });
      const recipient = emergency
        ? await prisma.emergencyRecipient.findUnique({
            where: { emergencyId_brigadistaId: { emergencyId: emergency.id, brigadistaId: req.auth!.brigadistaId! } },
          })
        : null;
      if (!emergency || !recipient) return reply.status(204).send();
      const notices = await prisma.emergencyNotice.findMany({
        where: { emergencyId: emergency.id },
        orderBy: { createdAt: "asc" },
      });
      return {
        emergency: syncEmergency(emergency),
        notices: notices.map(syncNotice),
        recipient: syncRecipient(recipient),
      };
    },
  );
}

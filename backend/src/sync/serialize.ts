import type { Emergency, EmergencyNotice, EmergencyRecipient } from "../generated/prisma/client.js";
import { toNum } from "../db.js";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const syncEmergency = (e: Emergency) => ({
  id: e.id,
  emergencyType: e.emergencyType,
  meetingPoint: e.meetingPoint,
  scheduledAt: e.scheduledAt.toISOString(),
  instructions: e.instructions,
  status: e.status as "ACTIVE" | "CLOSED",
  activatedAt: e.activatedAt!.toISOString(),
  closedAt: iso(e.closedAt),
  rowVersion: toNum(e.rowVersion),
});

export const syncNotice = (n: EmergencyNotice) => ({
  id: n.id,
  emergencyId: n.emergencyId,
  kind: n.kind,
  message: n.message,
  createdAt: n.createdAt.toISOString(),
  rowVersion: toNum(n.rowVersion),
});

export const syncRecipient = (r: EmergencyRecipient) => ({
  id: r.id,
  emergencyId: r.emergencyId,
  addedReason: r.addedReason,
  convokedAt: r.convokedAt.toISOString(),
  currentResponse: r.currentResponse,
  currentResponseId: r.currentResponseId,
  respondedAt: iso(r.respondedAt),
  rowVersion: toNum(r.rowVersion),
});

// Estados derivados para el panel del coordinador (contrato v1:
// ReadinessState, ReachStatus). Nunca filtran a quién se convoca.
import type { Device, NoticeAck, NotificationDelivery } from "../generated/prisma/client.js";
import { config } from "../config.js";

export type ReadinessState = "READY" | "NO_DEVICE" | "PUSH_INVALID" | "PUSH_DISABLED" | "NOT_SYNCED_RECENTLY";
export type ReachStatus = "OPENED" | "RECEIVED" | "PROVIDER_ACCEPTED" | "SENDING" | "DELIVERY_FAILED" | "NO_DEVICE";

export function readiness(devices: Device[], now = new Date()) {
  const active = devices.filter((d) => !d.revokedAt);
  const valid = active.filter((d) => d.pushTokenStatus === "VALID");
  const lastSeen = active.reduce<Date | null>((m, d) => (d.lastSeenAt && (!m || d.lastSeenAt > m) ? d.lastSeenAt : m), null);
  let state: ReadinessState;
  if (active.length === 0) state = "NO_DEVICE";
  else if (valid.length === 0) state = active.some((d) => d.pushTokenStatus === "INVALID") ? "PUSH_INVALID" : "PUSH_DISABLED";
  else if (!lastSeen || now.getTime() - lastSeen.getTime() > config.readinessStaleMs) state = "NOT_SYNCED_RECENTLY";
  else state = "READY";
  return {
    state,
    activeDevices: active.length,
    validPushDevices: valid.length,
    lastSeenAt: lastSeen?.toISOString() ?? null,
  };
}

/** Llegada de un aviso a un convocado: un acuse del teléfono siempre gana. */
export function reach(
  noticeId: string,
  acks: NoticeAck[],
  deliveries: NotificationDelivery[],
  hasValidPushDevice: boolean,
): ReachStatus {
  const a = acks.filter((x) => x.noticeId === noticeId);
  if (a.some((x) => x.level === "OPENED")) return "OPENED";
  if (a.some((x) => x.level === "RECEIVED")) return "RECEIVED";
  const d = deliveries.filter((x) => x.noticeId === noticeId);
  if (d.some((x) => x.status === "PROVIDER_ACCEPTED" || x.status === "PROVIDER_DELIVERED")) return "PROVIDER_ACCEPTED";
  if (d.some((x) => x.status === "QUEUED" || x.status === "SENT")) return "SENDING";
  if (d.length > 0) return "DELIVERY_FAILED";
  return hasValidPushDevice ? "SENDING" : "NO_DEVICE";
}

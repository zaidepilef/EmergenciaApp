// Disponibilidad declarada (openspec/changes/add-availability). Informativa:
// nunca filtra la convocatoria (RN-06) ni cambia con la respuesta (RN-09).
import { config } from "./config.js";
import { toNum } from "./db.js";
import type { AvailabilityStatus } from "./generated/prisma/client.js";

export const AVAILABILITY_STATUSES = ["DISPONIBLE", "NO_DISPONIBLE", "EN_SERVICIO"] as const;

interface ProfileAvailability {
  availabilityStatus: AvailabilityStatus;
  availabilityDeclaredAt: Date;
  lastAvailabilityChangeId: string | null;
  rowVersion: bigint;
}

/** Esquema `Availability` del contrato. Sin declaración previa: `status: null` (D6). */
export function availabilityOf(p: ProfileAvailability, now = Date.now()) {
  const declared = p.lastAvailabilityChangeId !== null;
  return {
    status: declared ? p.availabilityStatus : null,
    declaredAt: declared ? p.availabilityDeclaredAt.toISOString() : null,
    stale: declared && now - p.availabilityDeclaredAt.getTime() > config.availabilityStaleMs,
    rowVersion: toNum(p.rowVersion),
  };
}

export type AvailabilityFilter = (typeof AVAILABILITY_STATUSES)[number] | "STALE" | "UNDECLARED";


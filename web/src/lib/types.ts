// Subconjunto del contrato OpenAPI v1 que usa el dashboard.
// TODO(web-architect): reemplazar por tipos generados con openapi-typescript.

export type ResponseStatus = "VOY" | "NO_PUEDO" | "PENDING";
export type ReachStatus = "OPENED" | "RECEIVED" | "PROVIDER_ACCEPTED" | "SENDING" | "DELIVERY_FAILED" | "NO_DEVICE";
export type AvailabilityStatus = "DISPONIBLE" | "NO_DISPONIBLE" | "EN_SERVICIO";
export type AvailabilityFilter = AvailabilityStatus | "STALE" | "UNDECLARED";

/** Disponibilidad declarada (contrato 1.1.0). Informativa: nunca filtra la convocatoria. */
export interface Availability {
  status: AvailabilityStatus | null;
  declaredAt: string | null;
  stale: boolean;
  rowVersion: number;
}

export interface AvailabilityCounts {
  disponible: number;
  noDisponible: number;
  enServicio: number;
  stale: number;
  undeclared: number;
}

export interface AvailabilityChange {
  id: string;
  status: AvailabilityStatus;
  source: string;
  estimatedAt: string;
  receivedAt: string;
  timeConfidence: string;
  createdOffline: boolean;
  syncResult: "APPLIED" | "SUPERSEDED" | "CONFLICT";
  current: boolean;
}

export type ReadinessState = "READY" | "NO_DEVICE" | "PUSH_INVALID" | "PUSH_DISABLED" | "NOT_SYNCED_RECENTLY";

export interface Me {
  id: string;
  fullName: string;
  roles: ("ADMINISTRADOR" | "COORDINADOR")[];
  capabilities: ("ADMIN" | "COORD" | "BRIG")[];
}

export interface EmergencyHeader {
  id: string;
  emergencyType: string;
  meetingPoint: string;
  scheduledAt: string;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
  activatedAt: string | null;
  closedAt: string | null;
}

export interface ActiveEmergencySummary {
  generatedAt: string;
  emergency: EmergencyHeader | null;
  responses: { total: number; voy: number; noPuedo: number; pending: number } | null;
  reach: { opened: number; received: number; providerAccepted: number; sending: number; deliveryFailed: number; noDevice: number } | null;
  pendingWithoutAck: number | null;
  pendingReviews: number;
}

export interface RecipientStatus {
  recipientId: string;
  brigadista: { id: string; fullName: string; phone: string | null; active: boolean };
  addedReason: "ACTIVATION" | "LATE_ADDITION";
  convokedAt: string;
  response: ResponseStatus;
  respondedAt: string | null;
  lateSyncAfterClose: boolean;
  reach: ReachStatus;
  notices: { noticeId: string; kind: string; reach: ReachStatus }[];
  hasPendingReview: boolean;
  lastSeenAt: string | null;
}

export interface Notice {
  id: string;
  kind: "ACTIVATION" | "UPDATE" | "CLOSURE" | string;
  message: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string };
}

export interface BrigadistaSummary {
  id: string;
  fullName: string;
  phone: string | null;
  active: boolean;
  accountActive: boolean;
  readiness: { state: ReadinessState; activeDevices: number; validPushDevices: number; lastSeenAt: string | null };
  availability: Availability;
}

/** Lo que entrega GET /bff/state en cada sondeo. */
export interface DashboardState {
  me: Me;
  summary: ActiveEmergencySummary;
  recipients: RecipientStatus[];
  notices: Notice[];
  instructions: string | null;
  brigadistas: BrigadistaSummary[];
  availability: AvailabilityCounts;
}

// ─── Administración (contrato v1, tag admin) ───

export type AppRole = "ADMINISTRADOR" | "COORDINADOR";

export interface UserSummary {
  id: string;
  rut: string;
  fullName: string;
  email: string | null;
  active: boolean;
  roles: AppRole[];
  brigadista: { id: string; active: boolean; phone: string | null; joinedAt: string; leftAt: string | null } | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserDetail extends UserSummary {
  passwordExpiresAt: string | null;
  deactivatedAt: string | null;
  devices: { id: string; platform: string; pushStatus: string; lastSeenAt: string | null; revokedAt: string | null }[];
}

export interface ProvisionalPassword {
  provisionalPassword: string;
  expiresAt: string;
}

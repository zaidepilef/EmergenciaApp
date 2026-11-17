import Constants from 'expo-constants';

/**
 * La API corre en el mismo PC que Metro: se usa la IP con la que Expo Go
 * cargó la app y el puerto 3000. Se puede fijar con EXPO_PUBLIC_API_URL.
 */
function resolveBaseUrl(): string {
  const fixed = process.env.EXPO_PUBLIC_API_URL;
  if (fixed) return fixed.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const host = hostUri.split(':')[0] || 'localhost';
  return `http://${host}:3000`;
}

export const API_URL = resolveBaseUrl();

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(code);
  }
}

/** Error de red: sin conexión o servidor inalcanzable. */
export class NetworkError extends Error {}

export async function request<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T | null> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    throw new NetworkError('network');
  }
  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiProblem(res.status, json?.code ?? 'UNKNOWN', json);
  return json as T;
}

// ─── Tipos del contrato OpenAPI v1 (subconjunto) ───

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionScope: 'FULL' | 'PASSWORD_CHANGE_ONLY';
}

export type AvailabilityStatus = 'DISPONIBLE' | 'NO_DISPONIBLE' | 'EN_SERVICIO';

/** Disponibilidad declarada (contrato 1.1.0). Informativa: no cambia la convocatoria. */
export interface Availability {
  status: AvailabilityStatus | null;
  declaredAt: string | null;
  stale: boolean;
  rowVersion: number;
}

export interface Me {
  id: string;
  fullName: string;
  email: string | null;
  roles: string[];
  capabilities: string[];
  mustChangePassword: boolean;
  brigadista: { id: string; active: boolean; availability: Availability } | null;
}

export interface LoginResponse {
  tokens: AuthTokens;
  me: Me;
}

export interface SyncNotice {
  id: string;
  emergencyId: string;
  kind: 'ACTIVATION' | 'UPDATE' | 'CLOSURE' | string;
  message: string | null;
  createdAt: string;
  rowVersion: number;
}

export interface MyActiveEmergency {
  emergency: {
    id: string;
    emergencyType: string;
    meetingPoint: string;
    scheduledAt: string;
    instructions: string | null;
    status: 'ACTIVE' | 'CLOSED';
    activatedAt: string;
    closedAt: string | null;
    rowVersion: number;
  };
  notices: SyncNotice[];
  recipient: {
    id: string;
    emergencyId: string;
    currentResponse: 'VOY' | 'NO_PUEDO' | null;
    currentResponseId: string | null;
    respondedAt: string | null;
    rowVersion: number;
  };
}

export interface SyncOperationResult {
  operationId: string;
  result: 'APPLIED' | 'SUPERSEDED' | 'CONFLICT' | 'REJECTED';
  code: string | null;
  duplicate: boolean;
  entityId: string | null;
  rowVersion: number | null;
  lateSyncAfterClose: boolean;
}

export interface SyncPushResponse {
  syncEpoch: string;
  serverTime: string;
  results: SyncOperationResult[];
}

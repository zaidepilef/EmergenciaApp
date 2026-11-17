// DEMO: persistencia mínima en SecureStore. La app real usará SQLite según
// docs/database/synchronization/offline-storage.md (mobile-architect).
import * as SecureStore from 'expo-secure-store';
import { uuidv7 } from './uuid';

export type ResponseValue = 'VOY' | 'NO_PUEDO';

export interface OutboxOperation {
  operationId: string;
  deviceSeq: number;
  type: 'RESPOND_EMERGENCY' | 'ACK_NOTICE' | 'DECLARE_AVAILABILITY';
  declaredAt: string;
  declaredMonotonicMs: number | null;
  bootSessionId: string | null;
  createdOffline: boolean;
  baseRowVersion?: number;
  payload: Record<string, string>;
  /** Estado local: PENDING hasta que el servidor responde. */
  state: 'PENDING' | 'SENT' | 'REJECTED';
  result?: string;
  code?: string | null;
}

export interface Persisted {
  /** device.id y el contador viven juntos: nunca uno sin el otro. */
  deviceId: string;
  nextDeviceSeq: number;
  refreshToken: string | null;
  outbox: OutboxOperation[];
  ackedNotices: string[];
}

const KEY = 'emergencia_demo_state_v1';

export async function load(): Promise<Persisted> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) return JSON.parse(raw) as Persisted;
  } catch {
    // estado ilegible: empezar de nuevo
  }
  return freshState();
}

export function freshState(): Persisted {
  return { deviceId: uuidv7(), nextDeviceSeq: 1, refreshToken: null, outbox: [], ackedNotices: [] };
}

export async function save(state: Persisted): Promise<void> {
  // Se conservan solo las últimas operaciones enviadas (las pendientes, todas).
  const pending = state.outbox.filter((o) => o.state === 'PENDING');
  const done = state.outbox.filter((o) => o.state !== 'PENDING').slice(-10);
  const trimmed = { ...state, outbox: [...done, ...pending].sort((a, b) => a.deviceSeq - b.deviceSeq) };
  await SecureStore.setItemAsync(KEY, JSON.stringify(trimmed));
}

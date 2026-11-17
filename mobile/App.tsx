// DEMO conectada a la API local (backend/). Ver README.md.
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  API_URL,
  ApiProblem,
  NetworkError,
  request,
  type AuthTokens,
  type AvailabilityStatus,
  type LoginResponse,
  type Me,
  type MyActiveEmergency,
  type SyncPushResponse,
} from './src/api';
import { freshState, load, save, type OutboxOperation, type Persisted, type ResponseValue } from './src/storage';
import { uuidv7 } from './src/uuid';

const C = {
  bg: '#eef1f5',
  surface: '#ffffff',
  line: '#d5dbe4',
  fg: '#141a24',
  muted: '#566173',
  alarm: '#b42318',
  go: '#13703a',
  goSoft: '#dcf3e4',
  no: '#9f1d1d',
  noSoft: '#fbe3e3',
  wait: '#8a5a00',
  waitSoft: '#fdf0d2',
  accent: '#1d4ed8',
};

const POLL_MS = 10_000;
// "Arranque" = este proceso de la app: el reloj monotónico solo es comparable dentro de él.
const BOOT_SESSION_ID = uuidv7();
const monotonicNow = () => Math.floor(performance.now());

/** RN-03: pasadas 4 h la disponibilidad se marca desactualizada; el estado no cambia. */
const AVAILABILITY_STALE_MS = 4 * 3600_000;

const AVAILABILITY: Record<AvailabilityStatus, { label: string; icon: string; color: string; soft: string }> = {
  DISPONIBLE: { label: 'Disponible', icon: '✓', color: '#13703a', soft: '#dcf3e4' },
  NO_DISPONIBLE: { label: 'No disponible', icon: '✕', color: '#9f1d1d', soft: '#fbe3e3' },
  EN_SERVICIO: { label: 'En servicio', icon: '◉', color: '#1d4ed8', soft: '#dfe8fd' },
};

function ago(iso: string, now: number) {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—';

const NOTICE_LABEL: Record<string, string> = {
  ACTIVATION: 'Convocatoria',
  UPDATE: 'Actualización',
  CLOSURE: 'Cierre',
};

const CODE_TEXT: Record<string, string> = {
  EMERGENCY_CLOSED: 'La convocatoria ya estaba cerrada cuando respondiste.',
  NOT_A_RECIPIENT: 'No figuras como convocado en esta convocatoria.',
  INVALID_PAYLOAD: 'El servidor no pudo leer la respuesta.',
  ACCOUNT_INACTIVE: 'Tu cuenta está desactivada.',
  AMBIGUOUS_ORDER: 'Llegaron dos respuestas casi a la vez; el coordinador la revisará.',
  LATE_AFTER_CLOSE: 'Respondiste justo al cierre; el coordinador la revisará.',
};

type Phase = 'boot' | 'login' | 'main';

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [me, setMe] = useState<Me | null>(null);
  const [active, setActive] = useState<MyActiveEmergency | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [simOffline, setSimOffline] = useState(false);
  const [reachable, setReachable] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxOperation[]>([]);
  const [changing, setChanging] = useState(false);

  const store = useRef<Persisted>(freshState());
  const access = useRef<string | null>(null);
  const offlineRef = useRef(false);
  const busy = useRef(false);

  const persist = useCallback(async () => {
    setOutbox([...store.current.outbox]);
    await save(store.current);
  }, []);

  // ─── Llamadas autenticadas con renovación del token ───
  const refresh = useCallback(async (): Promise<boolean> => {
    const rt = store.current.refreshToken;
    if (!rt) return false;
    try {
      const t = await request<AuthTokens>('POST', '/v1/auth/refresh', { refreshToken: rt });
      access.current = t!.accessToken;
      store.current.refreshToken = t!.refreshToken;
      await save(store.current);
      return true;
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      return false;
    }
  }, []);

  const goToLogin = useCallback(async () => {
    access.current = null;
    store.current.refreshToken = null;
    await save(store.current);
    setPhase('login');
  }, []);

  const authed = useCallback(
    async <T,>(method: string, path: string, body?: unknown): Promise<T | null> => {
      if (offlineRef.current) throw new NetworkError('simulated');
      try {
        return await request<T>(method, path, body, access.current);
      } catch (e) {
        if (e instanceof ApiProblem && e.status === 401) {
          if (await refresh()) return request<T>(method, path, body, access.current);
          await goToLogin();
        }
        throw e;
      }
    },
    [refresh, goToLogin],
  );

  // ─── Sincronización: enviar la cola y descargar la convocatoria ───
  const sync = useCallback(async () => {
    if (busy.current || offlineRef.current || !access.current) return;
    busy.current = true;
    try {
      const pending = store.current.outbox.filter((o) => o.state === 'PENDING');
      if (pending.length > 0) {
        const res = await authed<SyncPushResponse>('POST', '/v1/sync/push', {
          clock: { deviceNow: new Date().toISOString(), monotonicMs: monotonicNow(), bootSessionId: BOOT_SESSION_ID },
          operations: pending.map(({ state: _s, result: _r, code: _c, ...op }) => op),
        });
        for (const r of res!.results) {
          const op = store.current.outbox.find((o) => o.operationId === r.operationId);
          if (!op) continue;
          op.state = r.result === 'REJECTED' ? 'REJECTED' : 'SENT';
          op.result = r.result;
          op.code = r.code;
        }
        await persist();
      }
      // Estado vigente del servidor (incluye la disponibilidad, que puede venir de otro teléfono).
      const meNow = await authed<Me>('GET', '/v1/me');
      if (meNow) setMe(meNow);
      const data = await authed<MyActiveEmergency>('GET', '/v1/me/active-emergency');
      setActive(data);
      setLoadedOnce(true);
      setReachable(true);
      setLastSync(new Date().toISOString());

      // Acuse "abrió el aviso" para los avisos que se muestran por primera vez.
      if (data) {
        for (const n of data.notices) {
          if (store.current.ackedNotices.includes(n.id)) continue;
          store.current.ackedNotices.push(n.id);
          enqueue({ type: 'ACK_NOTICE', payload: { noticeId: n.id, recipientId: data.recipient.id, level: 'OPENED' } });
        }
        await persist();
      }
    } catch (e) {
      if (e instanceof NetworkError) setReachable(false);
      else if (e instanceof ApiProblem && e.code === 'DEVICE_SEQ_CONFLICT') {
        // C15: nuevo device.id y login nuevo; las operaciones pendientes se conservan.
        store.current.deviceId = uuidv7();
        await goToLogin();
      } else if (e instanceof ApiProblem && e.code === 'DEVICE_REVOKED') {
        store.current = freshState();
        await goToLogin();
      }
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, persist, goToLogin]);

  function enqueue(op: Pick<OutboxOperation, 'type' | 'payload' | 'baseRowVersion'>) {
    const s = store.current;
    s.outbox.push({
      operationId: uuidv7(),
      deviceSeq: s.nextDeviceSeq++,
      declaredAt: new Date().toISOString(),
      declaredMonotonicMs: monotonicNow(),
      bootSessionId: BOOT_SESSION_ID,
      createdOffline: offlineRef.current || !reachable,
      state: 'PENDING',
      ...op,
    });
  }

  async function respond(value: ResponseValue) {
    if (!active) return;
    enqueue({
      type: 'RESPOND_EMERGENCY',
      baseRowVersion: active.recipient.rowVersion,
      payload: { recipientId: active.recipient.id, response: value },
    });
    setChanging(false);
    await persist(); // guardado en el teléfono antes de intentar enviar
    void sync();
  }

  async function declareAvailability(status: AvailabilityStatus) {
    const current = me?.brigadista?.availability;
    if (!current) return;
    enqueue({ type: 'DECLARE_AVAILABILITY', baseRowVersion: current.rowVersion, payload: { status } });
    await persist(); // guardado en el teléfono antes de intentar enviar
    void sync();
  }

  // ─── Arranque: recuperar la sesión guardada ───
  useEffect(() => {
    (async () => {
      store.current = await load();
      setOutbox([...store.current.outbox]);
      try {
        if (await refresh()) {
          const m = await request<Me>('GET', '/v1/me', undefined, access.current);
          setMe(m);
          setPhase('main');
          return;
        }
      } catch {
        // sin red al abrir: se pide login (la demo no guarda el token de acceso)
      }
      setPhase('login');
    })();
  }, [refresh]);

  useEffect(() => {
    if (phase !== 'main') return;
    void sync();
    const t = setInterval(() => void sync(), POLL_MS);
    return () => clearInterval(t);
  }, [phase, sync]);

  function toggleOffline(v: boolean) {
    offlineRef.current = v;
    setSimOffline(v);
    if (!v) setTimeout(() => void sync(), 100);
  }

  async function logout() {
    try {
      await authed('POST', '/v1/auth/logout');
    } catch {
      // se cierra igual en el teléfono
    }
    await goToLogin();
    setMe(null);
    setActive(null);
  }

  // ─── Pantallas ───
  if (phase === 'boot') {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (phase === 'login') {
    return (
      <LoginScreen
        onLoggedIn={async (res) => {
          access.current = res.tokens.accessToken;
          store.current.refreshToken = res.tokens.refreshToken;
          await save(store.current);
          setMe(res.me);
          setPhase('main');
        }}
        store={store}
      />
    );
  }

  const pendingCount = outbox.filter((o) => o.state === 'PENDING').length;
  const lastResponse = [...outbox].reverse().find((o) => o.type === 'RESPOND_EMERGENCY' && o.payload['recipientId'] === active?.recipient.id);
  const localPending = lastResponse?.state === 'PENDING' ? lastResponse : null;
  const lastRejected = lastResponse?.state === 'REJECTED' ? lastResponse : null;
  const shownValue = (localPending?.payload['response'] as ResponseValue | undefined) ?? active?.recipient.currentResponse ?? null;
  const offline = simOffline || !reachable;

  const availabilityCard = me?.brigadista ? (
    <AvailabilityCard
      server={me.brigadista.availability}
      outbox={outbox}
      offline={offline}
      duringEmergency={!!active && active.emergency.status === 'ACTIVE'}
      onDeclare={declareAvailability}
    />
  ) : null;

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <View style={s.topbar}>
        <View style={{ flex: 1 }}>
          <Text style={s.appName}>EmergenciaApp</Text>
          <Text style={s.user}>{me?.fullName} · Brigadista</Text>
        </View>
        <View style={s.demoSwitch}>
          <Text style={s.demoLabel}>Sin conexión</Text>
          <Switch
            value={simOffline}
            onValueChange={toggleOffline}
            trackColor={{ true: C.wait, false: C.line }}
            accessibilityLabel="Simular sin conexión"
          />
        </View>
      </View>

      <View style={[s.netBar, { backgroundColor: offline ? C.waitSoft : C.goSoft }]}>
        <Text style={[s.netText, { color: offline ? C.wait : C.go }]}>
          {simOffline
            ? `■ Sin conexión (simulada)${pendingCount ? ` · ${pendingCount} por enviar` : ''}`
            : !reachable
              ? `■ No se alcanza el servidor${pendingCount ? ` · ${pendingCount} por enviar` : ''}`
              : pendingCount
                ? '● Enviando…'
                : `● Conectado · sincronizado ${hhmm(lastSync)}`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {!loadedOnce && !offline && <ActivityIndicator color={C.accent} />}
        {!loadedOnce && offline && <Text style={s.muted}>Sin datos todavía: conéctate para descargar la convocatoria.</Text>}

        {loadedOnce && !active && (
          <>
            <View style={s.field}>
              <Text style={s.value}>Sin convocatorias activas</Text>
              <Text style={s.muted}>La app revisa cada 10 segundos.</Text>
            </View>
            {availabilityCard}
          </>
        )}

        {active && (
          <>
            <View style={s.alert}>
              <Text style={s.eyebrow}>
                CONVOCATORIA {active.emergency.status === 'ACTIVE' ? 'ACTIVA' : 'CERRADA'} · {hhmm(active.emergency.activatedAt)}
              </Text>
              <Text style={s.alertTitle}>{active.emergency.emergencyType}</Text>
            </View>

            {[...active.notices].reverse().map((n) => (
              <View key={n.id} style={[s.notice, n.kind === 'ACTIVATION' && { borderLeftColor: C.alarm, backgroundColor: C.surface }]}>
                <Text style={s.noticeTitle}>
                  {NOTICE_LABEL[n.kind] ?? 'Aviso'} {hhmm(n.createdAt)}
                </Text>
                {n.message ? <Text style={s.body}>{n.message}</Text> : null}
              </View>
            ))}

            <View style={s.field}>
              <Text style={s.label}>PUNTO DE ENCUENTRO</Text>
              <Text style={s.value}>{active.emergency.meetingPoint}</Text>
            </View>
            {active.emergency.instructions ? (
              <View style={s.field}>
                <Text style={s.label}>INSTRUCCIONES</Text>
                <Text style={s.body}>{active.emergency.instructions}</Text>
              </View>
            ) : null}

            {lastRejected && !localPending && (
              <View style={[s.notice, { borderLeftColor: C.no, backgroundColor: C.noSoft }]}>
                <Text style={s.noticeTitle}>No se registró tu última respuesta</Text>
                <Text style={s.body}>{CODE_TEXT[lastRejected.code ?? ''] ?? lastRejected.code}</Text>
              </View>
            )}

            {!shownValue || changing ? (
              <View style={{ gap: 10 }}>
                <Text style={s.label}>TU RESPUESTA</Text>
                <View style={s.answerRow}>
                  <Pressable
                    onPress={() => respond('VOY')}
                    style={({ pressed }) => [s.big, s.bigGo, pressed && s.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Voy"
                  >
                    <Text style={s.bigGoText}>✓ VOY</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respond('NO_PUEDO')}
                    style={({ pressed }) => [s.big, s.bigNo, pressed && s.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="No puedo"
                  >
                    <Text style={s.bigNoText}>✕ NO PUEDO</Text>
                  </Pressable>
                </View>
                {offline && (
                  <Text style={s.muted}>
                    Sin conexión: tu respuesta se guarda en el teléfono y se envía sola cuando vuelva la señal.
                  </Text>
                )}
                {changing && (
                  <Pressable onPress={() => setChanging(false)} style={s.linkBtn}>
                    <Text style={s.link}>Mantener mi respuesta actual</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={{ gap: 6 }}>
                <View style={[s.current, { borderColor: shownValue === 'VOY' ? C.go : C.no }]}>
                  <Text style={s.label}>
                    TU RESPUESTA · {hhmm(localPending ? localPending.declaredAt : active.recipient.respondedAt)}
                  </Text>
                  <Text style={[s.currentValue, { color: shownValue === 'VOY' ? C.go : C.no }]}>
                    {shownValue === 'VOY' ? '✓ VOY' : '✕ NO PUEDO'}
                  </Text>
                  {localPending ? (
                    <Text style={[s.body, { color: C.wait, fontWeight: '600' }]}>
                      ■ Guardada en el teléfono · se enviará al volver la conexión
                    </Text>
                  ) : (
                    <Text style={[s.body, { color: C.go, fontWeight: '600' }]}>● Registrada en el servidor</Text>
                  )}
                </View>
                <Pressable onPress={() => setChanging(true)} style={s.linkBtn}>
                  <Text style={s.link}>Cambiar mi respuesta</Text>
                </Pressable>
              </View>
            )}
            {availabilityCard}
          </>
        )}

        {outbox.some((o) => o.type === 'RESPOND_EMERGENCY' || o.type === 'DECLARE_AVAILABILITY') && (
          <View style={s.field}>
            <Text style={s.label}>HISTORIAL EN ESTE TELÉFONO</Text>
            {outbox
              .filter((o) => o.type === 'RESPOND_EMERGENCY' || o.type === 'DECLARE_AVAILABILITY')
              .reverse()
              .map((o) => (
                <View key={o.operationId} style={s.histRow}>
                  <Text style={s.histTime}>{hhmm(o.declaredAt)}</Text>
                  <Text style={[s.body, { flex: 1 }]}>
                    {o.type === 'DECLARE_AVAILABILITY'
                      ? `Disponibilidad: ${AVAILABILITY[o.payload['status'] as AvailabilityStatus]?.label ?? o.payload['status']}`
                      : o.payload['response'] === 'VOY'
                        ? 'Voy'
                        : 'No puedo'}
                    {o.createdOffline ? ' · sin conexión' : ''}
                  </Text>
                  <Text style={[s.histState, { color: o.state === 'SENT' ? C.go : o.state === 'REJECTED' ? C.no : C.wait }]}>
                    {o.state === 'PENDING' ? 'Pendiente' : o.state === 'REJECTED' ? 'Rechazada' : resultText(o.result)}
                  </Text>
                </View>
              ))}
          </View>
        )}

        <Pressable onPress={logout} style={s.linkBtn}>
          <Text style={[s.link, { color: C.muted }]}>Cerrar sesión</Text>
        </Pressable>
        <Text style={[s.muted, { textAlign: 'center' }]}>Demo · datos de ejemplo · {API_URL}</Text>
      </ScrollView>
    </View>
  );
}

/**
 * Mi disponibilidad (openspec/changes/add-availability). Informativa: no responde
 * la convocatoria ni cambia a quién se convoca. Funciona sin conexión.
 */
function AvailabilityCard({
  server,
  outbox,
  offline,
  duringEmergency,
  onDeclare,
}: {
  server: { status: AvailabilityStatus | null; declaredAt: string | null; stale: boolean };
  outbox: OutboxOperation[];
  offline: boolean;
  duringEmergency: boolean;
  onDeclare: (status: AvailabilityStatus) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const last = [...outbox].reverse().find((o) => o.type === 'DECLARE_AVAILABILITY');
  const pending = last?.state === 'PENDING' ? last : null;
  const rejected = last?.state === 'REJECTED' ? last : null;
  const status = (pending?.payload['status'] as AvailabilityStatus | undefined) ?? server.status;
  const declaredAt = pending ? pending.declaredAt : server.declaredAt;
  const stale = !!declaredAt && now - Date.parse(declaredAt) > AVAILABILITY_STALE_MS;
  const info = status ? AVAILABILITY[status] : null;

  return (
    <View style={[s.field, { gap: 10 }]}>
      <Text style={s.label}>MI DISPONIBILIDAD</Text>
      {info && declaredAt ? (
        <View style={{ gap: 2 }}>
          <Text style={[s.value, { color: info.color, fontSize: 22 }]}>
            {info.icon} {info.label}
          </Text>
          <Text style={s.muted}>
            Actualizado {ago(declaredAt, now)}
            {pending ? '' : ' · registrado en el servidor'}
          </Text>
        </View>
      ) : (
        <Text style={s.body}>Aún no la declaras. Ayuda al coordinador a saber con quién cuenta.</Text>
      )}

      {pending && (
        <Text style={[s.body, { color: C.wait, fontWeight: '600' }]}>
          ■ Guardada en el teléfono · {offline ? 'se enviará al volver la conexión' : 'enviando…'}
        </Text>
      )}
      {rejected && !pending && (
        <Text style={[s.body, { color: C.no, fontWeight: '600' }]}>
          No se registró tu último cambio: {CODE_TEXT[rejected.code ?? ''] ?? rejected.code}
        </Text>
      )}

      {stale && status && (
        <View style={[s.notice, { gap: 8 }]}>
          <Text style={s.noticeTitle}>◷ ¿Sigue vigente?</Text>
          <Text style={s.body}>La declaraste hace más de 4 horas. Confírmala o cámbiala.</Text>
          <Pressable
            onPress={() => onDeclare(status)}
            style={({ pressed }) => [s.availBtn, { borderColor: C.wait }, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Confirmar ${AVAILABILITY[status].label}`}
          >
            <Text style={[s.availText, { color: C.wait }]}>Sí, sigo {AVAILABILITY[status].label.toLowerCase()}</Text>
          </Pressable>
        </View>
      )}

      <View style={{ gap: 8 }}>
        {(Object.keys(AVAILABILITY) as AvailabilityStatus[]).map((k) => {
          const a = AVAILABILITY[k];
          const selected = k === status;
          return (
            <Pressable
              key={k}
              onPress={() => onDeclare(k)}
              style={({ pressed }) => [
                s.availBtn,
                { borderColor: a.color, backgroundColor: selected ? a.soft : C.surface },
                pressed && s.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={a.label}
            >
              <Text style={[s.availText, { color: a.color }]}>
                {a.icon} {a.label}
                {selected ? '  · actual' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.muted}>
        {duringEmergency
          ? 'Esto no responde la convocatoria: para eso usa VOY / NO PUEDO.'
          : 'Es informativa: si hay una emergencia te avisarán igual, estés o no disponible.'}
      </Text>
    </View>
  );
}

function resultText(result?: string) {
  if (result === 'APPLIED') return 'Enviada';
  if (result === 'SUPERSEDED') return 'Reemplazada';
  if (result === 'CONFLICT') return 'En revisión';
  return 'Enviada';
}

function LoginScreen({ onLoggedIn, store }: { onLoggedIn: (r: LoginResponse) => void; store: RefObject<Persisted> }) {
  const [rut, setRut] = useState('16.200.587-1');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(retried = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await request<LoginResponse>('POST', '/v1/auth/login', {
        clientType: 'MOBILE',
        rut,
        password,
        device: {
          id: store.current.deviceId,
          platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
          appVersion: Constants.expoConfig?.version ?? 'demo',
          osVersion: String(Platform.Version).slice(0, 32),
        },
      });
      onLoggedIn(res!);
    } catch (e) {
      if (e instanceof ApiProblem && (e.code === 'DEVICE_ID_CONFLICT' || e.code === 'DEVICE_REVOKED') && !retried) {
        // C13: el teléfono genera un device.id nuevo y reintenta.
        store.current.deviceId = uuidv7();
        store.current.nextDeviceSeq = 1;
        await save(store.current);
        return submit(true);
      }
      if (e instanceof NetworkError) setError(`No se alcanza el servidor (${API_URL}). ¿El PC y el teléfono están en la misma Wi-Fi y la API está corriendo?`);
      else if (e instanceof ApiProblem && e.code === 'INVALID_CREDENTIALS') setError('RUT o contraseña incorrectos.');
      else if (e instanceof ApiProblem && e.code === 'VALIDATION_ERROR') setError('Revisa el RUT: el dígito verificador no corresponde.');
      else if (e instanceof ApiProblem && e.code === 'RATE_LIMITED') setError('Demasiados intentos. Espera unos minutos.');
      else setError('No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[s.content, { paddingTop: 48 }]} keyboardShouldPersistTaps="handled">
        <Text style={[s.appName, { fontSize: 30 }]}>EmergenciaApp</Text>
        <Text style={s.muted}>Ingresa con tu RUT para recibir y responder convocatorias.</Text>
        <View style={{ gap: 6, marginTop: 12 }}>
          <Text style={s.label}>RUT</Text>
          <TextInput
            value={rut}
            onChangeText={setRut}
            style={s.input}
            autoCapitalize="characters"
            autoCorrect={false}
            keyboardType="default"
            placeholder="12.345.678-5"
            accessibilityLabel="RUT"
          />
        </View>
        <View style={{ gap: 6 }}>
          <Text style={s.label}>CONTRASEÑA</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            style={s.input}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={() => submit()}
            accessibilityLabel="Contraseña"
          />
        </View>
        {error && (
          <View style={[s.notice, { borderLeftColor: C.no, backgroundColor: C.noSoft }]}>
            <Text style={s.body}>{error}</Text>
          </View>
        )}
        <Pressable
          onPress={() => submit()}
          disabled={loading || !rut || !password}
          style={({ pressed }) => [s.primary, (loading || !rut || !password) && { opacity: 0.5 }, pressed && s.pressed]}
          accessibilityRole="button"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>Ingresar</Text>}
        </Pressable>
        <Text style={[s.muted, { textAlign: 'center' }]}>Demo · servidor {API_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 50,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface },
  appName: { fontSize: 20, fontWeight: '800', color: C.fg },
  user: { fontSize: 13, color: C.muted },
  demoSwitch: { alignItems: 'center' },
  demoLabel: { fontSize: 11, color: C.muted, fontWeight: '600' },
  netBar: { paddingHorizontal: 16, paddingVertical: 6 },
  netText: { fontSize: 13, fontWeight: '700' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  alert: { backgroundColor: C.alarm, borderRadius: 16, padding: 16, gap: 2 },
  eyebrow: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1.2, opacity: 0.9 },
  alertTitle: { color: '#fff', fontSize: 30, fontWeight: '800' },
  notice: { backgroundColor: C.waitSoft, borderLeftWidth: 4, borderLeftColor: C.wait, borderRadius: 8, padding: 12 },
  noticeTitle: { fontWeight: '800', color: C.fg, marginBottom: 2 },
  field: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, gap: 4 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: C.muted },
  value: { fontSize: 17, fontWeight: '700', color: C.fg },
  body: { fontSize: 15, color: C.fg },
  muted: { fontSize: 13, color: C.muted },
  answerRow: { flexDirection: 'row', gap: 10 },
  big: { flex: 1, minHeight: 76, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  bigGo: { backgroundColor: C.go, borderColor: C.go },
  bigNo: { backgroundColor: C.surface, borderColor: C.no },
  bigGoText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  bigNoText: { color: C.no, fontSize: 22, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  current: { backgroundColor: C.surface, borderWidth: 2, borderRadius: 14, padding: 14, gap: 6 },
  currentValue: { fontSize: 30, fontWeight: '800' },
  linkBtn: { minHeight: 48, justifyContent: 'center' },
  link: { color: C.accent, fontSize: 16, textDecorationLine: 'underline' },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line },
  histTime: { fontVariant: ['tabular-nums'], color: C.muted, fontSize: 14, width: 48 },
  histState: { fontSize: 13, fontWeight: '700' },
  availBtn: { minHeight: 52, borderWidth: 2, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 14 },
  availText: { fontSize: 18, fontWeight: '800' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 18,
    backgroundColor: C.surface,
    color: C.fg,
  },
  primary: { minHeight: 56, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});

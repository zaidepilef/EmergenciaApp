"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { logoutAction } from "./actions";
import type {
  AvailabilityChange,
  AvailabilityCounts,
  AvailabilityFilter,
  BrigadistaSummary,
  DashboardState,
  RecipientStatus,
  ResponseStatus,
} from "@/lib/types";
import { ago, AVAILABILITY, AvailabilityCell, Count, dayTime, hhmm, REACH, ReachCell, READINESS, RESPONSE, ResponsePill } from "./ui";

const POLL_MS = 10_000;

/** UUID v7 para el id de la convocatoria (idempotencia del alta). */
function uuidv7(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let ms = Date.now();
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const ERRORS: Record<string, string> = {
  EMERGENCY_ALREADY_ACTIVE: "Ya hay una convocatoria activa. Ciérrala antes de activar otra.",
  FORBIDDEN: "Tu cuenta no tiene permiso para esta acción (requiere rol de coordinador).",
  VALIDATION_ERROR: "Revisa los datos: hay campos vacíos o demasiado largos.",
  API_UNREACHABLE: "No se pudo conectar con el servidor.",
  FORBIDDEN_ORIGIN: "Petición rechazada por seguridad. Recarga la página.",
};

type Tab = "convocatoria" | "brigadistas";

export function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("convocatoria");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/bff/state", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        // REFRESH_RACE u otra falla transitoria: se reintenta en el próximo sondeo.
        if (json.code !== "REFRESH_RACE") setError(ERRORS[json.code] ?? "No se pudo actualizar el panel.");
        return;
      }
      setState(json as DashboardState);
      setError(null);
      setLastOk(Date.now());
    } catch {
      setError("Sin conexión con el servidor del panel.");
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const isCoord = state?.me.capabilities.includes("COORD") ?? false;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">EmergenciaApp</p>
          <h1 className="font-display text-3xl font-bold">Panel de brigada</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={`font-mono text-xs ${error ? "font-bold text-alarm" : "text-muted"}`} aria-live="polite">
            {error ? `■ ${error}` : lastOk ? `● Actualizado ${ago(new Date(lastOk).toISOString(), now)} · cada 10 s` : "Cargando…"}
          </span>
          {state && (
            <span className="text-muted">
              <strong className="text-fg">{state.me.fullName}</strong> · {state.me.roles.map((r) => (r === "COORDINADOR" ? "Coordinador" : "Administrador")).join(" y ")}
            </span>
          )}
          <form action={logoutAction}>
            <button className="min-h-10 rounded-full border border-line bg-surface px-4">Cerrar sesión</button>
          </form>
        </div>
      </header>

      <nav className="flex gap-2" aria-label="Secciones">
        {(["convocatoria", "brigadistas"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`min-h-10 rounded-full border px-4 font-semibold ${tab === t ? "border-fg bg-fg text-bg" : "border-line bg-surface"}`}
          >
            {t === "convocatoria" ? "Convocatoria" : `Brigadistas${state ? ` (${state.brigadistas.length})` : ""}`}
          </button>
        ))}
      </nav>

      {!state && !error && <p className="text-muted">Cargando el panel…</p>}
      {state && tab === "convocatoria" && <EmergencyView state={state} now={now} isCoord={isCoord} reload={load} />}
      {state && tab === "brigadistas" && <BrigadistasView items={state.brigadistas} counts={state.availability} now={now} />}
    </div>
  );
}

// ───────────────────────── Convocatoria ─────────────────────────

function EmergencyView({ state, now, isCoord, reload }: { state: DashboardState; now: number; isCoord: boolean; reload: () => Promise<void> }) {
  const { summary, recipients } = state;
  if (!summary.emergency || !summary.responses || !summary.reach) {
    return <NoActive brigadistas={state.brigadistas.length} availability={state.availability} isCoord={isCoord} reload={reload} />;
  }
  const e = summary.emergency;
  const r = summary.responses;
  const pct = (n: number) => `${(n / Math.max(r.total, 1)) * 100}%`;
  const callFirst = recipients.filter((x) => x.response === "PENDING" && x.reach !== "OPENED" && x.reach !== "RECEIVED");

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-alarm-soft px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-alarm">
              <span aria-hidden="true">●</span> Activa desde {hhmm(e.activatedAt)}
            </span>
            <h2 className="mt-2 font-display text-3xl font-bold text-balance">{e.emergencyType}</h2>
            <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <div>
                <dt className="inline">Punto de encuentro: </dt>
                <dd className="inline font-semibold text-fg">{e.meetingPoint}</dd>
              </div>
              <div>
                <dt className="inline">Presentarse: </dt>
                <dd className="inline font-semibold text-fg">{dayTime(e.scheduledAt)}</dd>
              </div>
            </dl>
            {state.instructions && <p className="mt-2 max-w-prose text-sm">{state.instructions}</p>}
          </div>
          {isCoord && <CloseButton id={e.id} reload={reload} />}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Count n={r.voy} label="Voy" tone="go" />
          <Count n={r.noPuedo} label="No puedo" tone="no" />
          <Count n={r.pending} label="Sin respuesta" tone="wait" />
          <Count n={r.total} label="Convocados (todos los activos)" />
        </div>
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <span className="bg-go transition-all" style={{ width: pct(r.voy) }} />
          <span className="bg-no transition-all" style={{ width: pct(r.noPuedo) }} />
          <span className="bg-wait transition-all" style={{ width: pct(r.pending) }} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-w-0 flex-col gap-3">
          <RecipientsTable items={recipients} now={now} />
        </section>
        <aside className="flex flex-col gap-5">
          {callFirst.length > 0 && (
            <section className="rounded-2xl border border-wait bg-wait-soft p-4">
              <h3 className="font-display text-xl font-bold">Llamar primero ({callFirst.length})</h3>
              <p className="mb-2 text-sm text-muted">Sin respuesta y sin confirmación de que el aviso llegó a su teléfono.</p>
              <ul className="flex flex-col gap-1.5">
                {callFirst.map((x) => (
                  <li key={x.recipientId} className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span className="font-semibold">{x.brigadista.fullName}</span>
                    <span className="font-mono tabular-nums">{x.brigadista.phone ?? "sin teléfono"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Llegada del aviso de activación</h3>
            <p className="mb-3 text-xs text-muted">Separada de la respuesta: que llegue no significa que respondió.</p>
            <ul className="flex flex-col gap-2 text-sm">
              {(
                [
                  ["OPENED", summary.reach.opened],
                  ["RECEIVED", summary.reach.received],
                  ["PROVIDER_ACCEPTED", summary.reach.providerAccepted],
                  ["SENDING", summary.reach.sending],
                  ["DELIVERY_FAILED", summary.reach.deliveryFailed],
                  ["NO_DEVICE", summary.reach.noDevice],
                ] as const
              ).map(([k, n]) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <ReachCell value={k} />
                  <span className="font-mono font-semibold tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </section>
          <Notices state={state} />
        </aside>
      </div>
    </div>
  );
}

function Notices({ state }: { state: DashboardState }) {
  const label: Record<string, string> = { ACTIVATION: "Activación", UPDATE: "Actualización", CLOSURE: "Cierre" };
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Avisos enviados</h3>
      <ol className="flex flex-col gap-2 text-sm">
        {state.notices.map((n) => (
          <li key={n.id} className="border-l-2 border-line pl-3">
            <span className="font-mono text-xs text-muted">{hhmm(n.createdAt)}</span> <strong>{label[n.kind] ?? n.kind}</strong>
            {n.message && <p>{n.message}</p>}
            <p className="text-xs text-muted">por {n.createdBy.fullName}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const FILTERS: (ResponseStatus | "ALL")[] = ["ALL", "PENDING", "VOY", "NO_PUEDO"];

function RecipientsTable({ items, now }: { items: RecipientStatus[]; now: number }) {
  const [filter, setFilter] = useState<ResponseStatus | "ALL">("ALL");
  const count = (f: ResponseStatus | "ALL") => (f === "ALL" ? items.length : items.filter((i) => i.response === f).length);
  const order: Record<ResponseStatus, number> = { PENDING: 0, NO_PUEDO: 1, VOY: 2 };
  const shown = useMemo(
    () =>
      items
        .filter((i) => filter === "ALL" || i.response === filter)
        .slice()
        .sort((a, b) => order[a.response] - order[b.response] || a.brigadista.fullName.localeCompare(b.brigadista.fullName, "es")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filter],
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-bold">Convocados</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por respuesta">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`min-h-9 rounded-full border px-3 text-sm ${filter === f ? "border-fg bg-fg text-bg" : "border-line bg-surface"}`}
            >
              {f === "ALL" ? "Todos" : RESPONSE[f].label} ({count(f)})
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-3 py-2.5">Brigadista</th>
              <th className="px-3 py-2.5">Respuesta</th>
              <th className="px-3 py-2.5">Hora</th>
              <th className="px-3 py-2.5">Llegada del aviso</th>
              <th className="px-3 py-2.5">Última conexión</th>
              <th className="px-3 py-2.5">Notas</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const notes = [
                i.addedReason === "LATE_ADDITION" && "Convocado tarde",
                i.lateSyncAfterClose && "Llegó después del cierre",
                i.hasPendingReview && "Revisión pendiente",
              ].filter(Boolean) as string[];
              return (
                <tr key={i.recipientId} className="border-t border-line align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{i.brigadista.fullName}</div>
                    <div className="whitespace-nowrap font-mono text-xs text-muted">{i.brigadista.phone ?? "sin teléfono"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <ResponsePill value={i.response} />
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums">{hhmm(i.respondedAt)}</td>
                  <td className="px-3 py-2.5">
                    <ReachCell value={i.reach} />
                  </td>
                  <td className="px-3 py-2.5 text-muted">{ago(i.lastSeenAt, now)}</td>
                  <td className="px-3 py-2.5">
                    {notes.length ? notes.map((n) => <span key={n} className="mr-1 inline-block rounded border border-line px-1.5 text-xs text-muted">{n}</span>) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  Nadie en este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CloseButton({ id, reload }: { id: string; reload: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function close() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/bff/emergencies/${id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(ERRORS[j.code] ?? "No se pudo cerrar la convocatoria.");
      return;
    }
    setConfirming(false);
    await reload();
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="min-h-11 rounded-xl border-2 border-alarm px-4 font-bold text-alarm">
        Cerrar convocatoria
      </button>
    );
  }
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-xl border-2 border-alarm bg-alarm-soft p-3">
      <p className="text-sm font-semibold">¿Cerrar la convocatoria? Se avisará a todos los convocados.</p>
      <label className="flex flex-col gap-1 text-sm">
        Mensaje de cierre (opcional)
        <input id="close-message" value={message} onChange={(ev) => setMessage(ev.target.value)} maxLength={1000} placeholder="Gracias, emergencia controlada" className="min-h-10 rounded-lg border border-line bg-surface px-2" />
      </label>
      {err && <p className="text-sm font-semibold text-alarm">{err}</p>}
      <div className="flex gap-2">
        <button onClick={close} disabled={busy} className="min-h-10 flex-1 rounded-lg bg-alarm font-bold text-white disabled:opacity-60">
          {busy ? "Cerrando…" : "Sí, cerrar"}
        </button>
        <button onClick={() => setConfirming(false)} className="min-h-10 flex-1 rounded-lg border border-line bg-surface">
          Volver
        </button>
      </div>
    </div>
  );
}

function localDateTimeValue(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function NoActive({
  brigadistas,
  availability,
  isCoord,
  reload,
}: {
  brigadistas: number;
  availability: AvailabilityCounts;
  isCoord: boolean;
  reload: () => Promise<void>;
}) {
  const [id, setId] = useState(uuidv7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true);
    setErr(null);
    const res = await fetch("/bff/emergencies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        emergencyType: f.get("emergencyType"),
        meetingPoint: f.get("meetingPoint"),
        scheduledAt: new Date(String(f.get("scheduledAt"))).toISOString(),
        instructions: f.get("instructions"),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(ERRORS[j.code] ?? "No se pudo activar la convocatoria.");
      return;
    }
    setId(uuidv7());
    await reload();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-5">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-go-soft px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-go">
            <span aria-hidden="true">○</span> Sin convocatoria activa
          </span>
          <h2 className="mt-2 font-display text-3xl font-bold">La brigada está en espera</h2>
          <p className="mt-1 text-muted">
            Al activar una convocatoria se avisa a los <strong className="text-fg">{brigadistas} brigadistas activos</strong>, sin importar su disponibilidad ni su última conexión.
          </p>
        </section>
        <AvailabilitySummary counts={availability} />
      </div>
      {isCoord ? (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-display text-xl font-bold">Nueva convocatoria</h3>
          <Field label="Tipo de emergencia" name="emergencyType" placeholder="Incendio forestal" maxLength={100} required />
          <Field label="Punto de encuentro" name="meetingPoint" placeholder="Cuartel 2, Av. Los Aromos 1450" maxLength={300} required />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">Presentarse a las</span>
            <input id="scheduledAt" name="scheduledAt" type="datetime-local" required defaultValue={localDateTimeValue(new Date())} className="min-h-11 rounded-lg border border-line bg-surface-2 px-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">Instrucciones (opcional)</span>
            <textarea id="instructions" name="instructions" maxLength={2000} rows={3} placeholder="Equipo de protección personal completo y radio cargada" className="rounded-lg border border-line bg-surface-2 p-2" />
          </label>
          {err && <p role="alert" className="rounded-lg border-l-4 border-no bg-no-soft px-3 py-2 text-sm">{err}</p>}
          <button type="submit" disabled={busy} className="min-h-12 rounded-xl bg-alarm text-lg font-bold text-white disabled:opacity-60">
            {busy ? "Activando…" : `Activar y convocar a ${brigadistas}`}
          </button>
          <p className="text-xs text-muted">Sin push real en la demo: los teléfonos la reciben al sincronizar (cada 10 s con la app abierta).</p>
        </form>
      ) : (
        <p className="text-muted">Solo un coordinador puede crear convocatorias.</p>
      )}
    </div>
  );
}

function Field(props: { label: string; name: string; placeholder: string; maxLength: number; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-wider text-muted">{props.label}</span>
      <input id={props.name} name={props.name} placeholder={props.placeholder} maxLength={props.maxLength} required={props.required} className="min-h-11 rounded-lg border border-line bg-surface-2 px-2" />
    </label>
  );
}

// ───────────────────────── Brigadistas ─────────────────────────

const RESULT_TEXT: Record<AvailabilityChange["syncResult"], string> = {
  APPLIED: "Aplicada",
  SUPERSEDED: "Reemplazada por una más nueva",
  CONFLICT: "En conflicto",
};

function AvailabilityHistory({ brigadista, now, onClose }: { brigadista: BrigadistaSummary; now: number; onClose: () => void }) {
  const [items, setItems] = useState<AvailabilityChange[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/bff/brigadistas/${brigadista.id}/availability`, { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) setErr(ERRORS[j.code] ?? "No se pudo cargar el historial.");
        else setItems(j.items as AvailabilityChange[]);
      } catch {
        if (alive) setErr("Sin conexión con el servidor del panel.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [brigadista.id]);

  return (
    <section className="rounded-2xl border-2 border-fg bg-surface p-4" aria-label={`Historial de disponibilidad de ${brigadista.fullName}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-xl font-bold">{brigadista.fullName}</h3>
          <p className="text-sm text-muted">Historial de disponibilidad, más reciente primero.</p>
        </div>
        <button onClick={onClose} className="min-h-10 rounded-full border border-line px-4">
          Cerrar historial
        </button>
      </div>
      {err && <p className="mt-2 text-sm font-semibold text-alarm">{err}</p>}
      {!items && !err && <p className="mt-2 text-muted">Cargando…</p>}
      {items && items.length === 0 && <p className="mt-2 text-muted">Nunca ha declarado su disponibilidad.</p>}
      {items && items.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2 text-sm">
          {items.map((c) => {
            const a = AVAILABILITY[c.status];
            return (
              <li key={c.id} className={`flex flex-wrap items-baseline gap-x-3 border-l-2 pl-3 ${c.current ? "border-fg" : "border-line"}`}>
                <span className="font-mono text-xs tabular-nums text-muted">{dayTime(c.estimatedAt)}</span>
                <span className={`font-semibold ${a.cls}`}>
                  <span aria-hidden="true">{a.icon} </span>
                  {a.label}
                </span>
                {c.current && <span className="rounded border border-fg px-1.5 text-xs font-bold">Vigente</span>}
                <span className="text-xs text-muted">
                  {RESULT_TEXT[c.syncResult]}
                  {c.createdOffline ? " · hecha sin conexión" : ""}
                  {" · llegó "}
                  {ago(c.receivedAt, now)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const AV_FILTERS: { key: AvailabilityFilter | "ALL"; label: string; icon: string; count: (c: AvailabilityCounts, total: number) => number }[] = [
  { key: "ALL", label: "Todos", icon: "", count: (_c, t) => t },
  { key: "DISPONIBLE", label: "Disponible", icon: "✓", count: (c) => c.disponible },
  { key: "NO_DISPONIBLE", label: "No disponible", icon: "✕", count: (c) => c.noDisponible },
  { key: "EN_SERVICIO", label: "En servicio", icon: "◉", count: (c) => c.enServicio },
  { key: "STALE", label: "Desactualizada (+4 h)", icon: "◷", count: (c) => c.stale },
  { key: "UNDECLARED", label: "Sin declarar", icon: "?", count: (c) => c.undeclared },
];

const matchesAvailability = (b: BrigadistaSummary, f: AvailabilityFilter | "ALL") =>
  f === "ALL" || (f === "UNDECLARED" ? b.availability.status === null : f === "STALE" ? b.availability.stale : b.availability.status === f);

/** Conteo por disponibilidad declarada (informativa: no cambia a quién se convoca). */
function AvailabilitySummary({ counts }: { counts: AvailabilityCounts }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Disponibilidad declarada</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Count n={counts.disponible} label="Disponible" tone="go" />
        <Count n={counts.noDisponible} label="No disponible" tone="no" />
        <Count n={counts.enServicio} label="En servicio" />
      </div>
      <p className="mt-3 text-sm text-muted">
        <span className={counts.stale ? "font-semibold text-wait" : ""}>
          <span aria-hidden="true">◷ </span>
          {counts.stale} desactualizada{counts.stale === 1 ? "" : "s"} (más de 4 h)
        </span>
        {" · "}
        {counts.undeclared} sin declarar. Es informativa: la convocatoria llega igual a todos.
      </p>
    </section>
  );
}

function BrigadistasView({ items, counts, now }: { items: BrigadistaSummary[]; counts: AvailabilityCounts; now: number }) {
  const [filter, setFilter] = useState<AvailabilityFilter | "ALL">("ALL");
  const [open, setOpen] = useState<BrigadistaSummary | null>(null);
  const readinessCounts = Object.keys(READINESS).map((k) => [k, items.filter((i) => i.readiness.state === k).length] as const);
  const shown = items.filter((b) => matchesAvailability(b, filter));
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted">
        La disponibilidad y la preparación son informativas: <strong className="text-fg">nunca</strong> cambian a quién se convoca. Sirven para anticipar con quién cuentas y a quién contactar por otro medio.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Disponibilidad</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por disponibilidad">
          {AV_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm ${filter === f.key ? "border-fg bg-fg text-bg" : "border-line bg-surface"}`}
            >
              {f.icon && <span aria-hidden="true">{f.icon}</span>}
              {f.label} <b className="font-mono">{f.count(counts, items.length)}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Preparación del teléfono</span>
        <div className="flex flex-wrap gap-2">
          {readinessCounts.map(([k, n]) => {
            const r = READINESS[k as keyof typeof READINESS];
            return (
              <span key={k} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${r.bad && n ? "border-alarm text-alarm" : "border-line"}`}>
                <span aria-hidden="true">{r.icon}</span>
                {r.label}
                <b className="font-mono">{n}</b>
              </span>
            );
          })}
        </div>
      </div>
      {open && <AvailabilityHistory brigadista={open} now={now} onClose={() => setOpen(null)} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[780px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-3 py-2.5">Brigadista</th>
              <th className="px-3 py-2.5">Teléfono</th>
              <th className="px-3 py-2.5">Disponibilidad</th>
              <th className="px-3 py-2.5">Preparación</th>
              <th className="px-3 py-2.5">Dispositivos</th>
              <th className="px-3 py-2.5">Última conexión</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  Nadie en este filtro.
                </td>
              </tr>
            )}
            {shown.map((b) => {
              const r = READINESS[b.readiness.state];
              return (
                <tr key={b.id} className="border-t border-line align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{b.fullName}</div>
                    <button onClick={() => setOpen(b)} className="text-xs text-accent underline">
                      Historial de disponibilidad
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums">{b.phone ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <AvailabilityCell value={b.availability} now={now} />
                  </td>
                  <td className={`px-3 py-2.5 ${r.bad ? "font-semibold text-alarm" : "text-go"}`}>
                    <span aria-hidden="true" className="mr-1.5">{r.icon}</span>
                    {r.label}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {b.readiness.activeDevices} · {b.readiness.validPushDevices} con notificaciones
                  </td>
                  <td className="px-3 py-2.5 text-muted">{ago(b.readiness.lastSeenAt, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Leyenda de llegada del aviso: {Object.values(REACH).map((r) => r.label).join(" · ")}.</p>
    </div>
  );
}

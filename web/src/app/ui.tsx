// Piezas visuales del panel. Cada estado lleva icono y texto, no solo color.
import type { Availability, AvailabilityStatus, ReachStatus, ReadinessState, ResponseStatus } from "@/lib/types";

const tz = "America/Santiago";
export const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—";
export const dayTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz })
    : "—";

export function ago(iso: string | null, now: number) {
  if (!iso) return "nunca";
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export const RESPONSE: Record<ResponseStatus, { label: string; icon: string; cls: string }> = {
  VOY: { label: "Voy", icon: "✓", cls: "bg-go-soft text-go" },
  NO_PUEDO: { label: "No puedo", icon: "✕", cls: "bg-no-soft text-no" },
  PENDING: { label: "Sin respuesta", icon: "◷", cls: "bg-wait-soft text-wait" },
};

export function ResponsePill({ value }: { value: ResponseStatus }) {
  const r = RESPONSE[value];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold ${r.cls}`}>
      <span aria-hidden="true">{r.icon}</span>
      {r.label}
    </span>
  );
}

/** Llegada del aviso, de mayor a menor certeza (contrato: ReachStatus). */
export const REACH: Record<ReachStatus, { label: string; icon: string; bad?: boolean; hint: string }> = {
  OPENED: { label: "Abrió el aviso", icon: "◉", hint: "El teléfono confirmó que lo abrió" },
  RECEIVED: { label: "Llegó al teléfono", icon: "✓", hint: "El teléfono confirmó que lo recibió" },
  PROVIDER_ACCEPTED: { label: "Aceptado por el servicio push", icon: "→", hint: "Sin confirmación del teléfono todavía" },
  SENDING: { label: "Enviando", icon: "…", hint: "En cola o enviado, sin respuesta del proveedor" },
  DELIVERY_FAILED: { label: "No se pudo entregar", icon: "!", bad: true, hint: "El proveedor rechazó el envío" },
  NO_DEVICE: { label: "Sin teléfono con notificaciones", icon: "–", bad: true, hint: "Solo lo verá al abrir la app" },
};

export function ReachCell({ value }: { value: ReachStatus }) {
  const r = REACH[value];
  return (
    <span title={r.hint} className={`inline-flex items-center gap-1.5 whitespace-nowrap ${r.bad ? "font-semibold text-alarm" : ""}`}>
      <span aria-hidden="true" className="w-4 text-center font-mono font-bold">
        {r.icon}
      </span>
      {r.label}
    </span>
  );
}

export const READINESS: Record<ReadinessState, { label: string; icon: string; bad: boolean }> = {
  READY: { label: "Listo", icon: "✓", bad: false },
  NO_DEVICE: { label: "Sin teléfono", icon: "–", bad: true },
  PUSH_INVALID: { label: "Push rechazado", icon: "!", bad: true },
  PUSH_DISABLED: { label: "Notificaciones desactivadas", icon: "⊘", bad: true },
  NOT_SYNCED_RECENTLY: { label: "Sin sincronizar (+72 h)", icon: "◷", bad: true },
};

/** Disponibilidad declarada: icono + texto, nunca solo color. */
export const AVAILABILITY: Record<AvailabilityStatus, { label: string; icon: string; cls: string }> = {
  DISPONIBLE: { label: "Disponible", icon: "✓", cls: "text-go" },
  NO_DISPONIBLE: { label: "No disponible", icon: "✕", cls: "text-no" },
  EN_SERVICIO: { label: "En servicio", icon: "◉", cls: "text-accent" },
};

export function AvailabilityCell({ value, now }: { value: Availability; now: number }) {
  if (!value.status) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted">
        <span aria-hidden="true">?</span>Sin declarar
      </span>
    );
  }
  const a = AVAILABILITY[value.status];
  return (
    <span className="flex flex-col">
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold ${a.cls}`}>
        <span aria-hidden="true">{a.icon}</span>
        {a.label}
      </span>
      <span className={`whitespace-nowrap text-xs ${value.stale ? "font-semibold text-wait" : "text-muted"}`}>
        {value.stale && <span aria-hidden="true">◷ </span>}
        {ago(value.declaredAt, now)}
        {value.stale && " · desactualizada"}
      </span>
    </span>
  );
}

export function Count({ n, label, tone }: { n: number; label: string; tone?: "go" | "no" | "wait" }) {
  const color = tone === "go" ? "text-go" : tone === "no" ? "text-no" : tone === "wait" ? "text-wait" : "";
  const icon = tone === "go" ? "✓" : tone === "no" ? "✕" : tone === "wait" ? "◷" : "";
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface-2 p-3">
      <span className={`font-display text-5xl leading-none font-bold tabular-nums ${color}`}>{n}</span>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-muted">
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
      </span>
    </div>
  );
}

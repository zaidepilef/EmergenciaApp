"use client";

// Administración de cuentas: alta, edición, baja (desactivar), roles y
// condición de brigadista. Solo ADMINISTRADOR. Consume /bff/admin/* (BFF).
import { useCallback, useEffect, useState } from "react";
import type { AppRole, ProvisionalPassword, UserDetail, UserSummary } from "@/lib/types";
import { ago, dayTime } from "./ui";

const ERRORS: Record<string, string> = {
  RUT_ALREADY_EXISTS: "Ese RUT ya tiene una cuenta. Búscala en la lista.",
  EMAIL_ALREADY_EXISTS: "Ese correo ya está registrado en otra cuenta.",
  LAST_ADMIN: "Es el último administrador activo: asigna otro antes de quitarle el rol o desactivarla.",
  CANNOT_DEACTIVATE_SELF: "No puedes desactivar tu propia cuenta.",
  USER_INACTIVE: "La cuenta está desactivada: reactívala primero.",
  VALIDATION_ERROR: "Revisa los datos: RUT (con dígito verificador), nombre, correo o teléfono (+56 9 1234 5678).",
  FORBIDDEN: "Tu cuenta no tiene permiso de administrador.",
  NOT_FOUND: "La cuenta ya no existe.",
  FORBIDDEN_ORIGIN: "Petición rechazada por seguridad. Recarga la página.",
  API_UNREACHABLE: "No se pudo conectar con el servidor.",
};
const ROLE_LABEL: Record<AppRole, string> = { ADMINISTRADOR: "Administrador", COORDINADOR: "Coordinador" };
const ROLES: AppRole[] = ["ADMINISTRADOR", "COORDINADOR"];

async function admin<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/bff/admin/${path}`, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) window.location.href = "/login";
  if (json.code === "PASSWORD_CHANGE_REQUIRED") window.location.href = "/cambiar-clave";
  if (!res.ok) throw new Error(ERRORS[json.code] ?? "No se pudo completar la acción.");
  return json as T;
}

const formatRut = (rut: string) => {
  const [body, dv] = rut.split("-");
  return `${Number(body).toLocaleString("es-CL")}-${dv}`;
};

const input = "min-h-11 rounded-lg border border-line bg-surface-2 px-2";
const label = "text-xs font-bold uppercase tracking-wider text-muted";

export function UsersView({ myUserId, now, onChanged }: { myUserId: string; now: number; onChanged: () => void }) {
  const [items, setItems] = useState<UserSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("active");
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; data: ProvisionalPassword; note?: string } | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ limit: "100" });
    if (q.trim()) qs.set("q", q.trim());
    if (status !== "all") qs.set("active", String(status === "active"));
    try {
      setItems((await admin<{ items: UserSummary[] }>("GET", `users?${qs}`)).items);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const changed = async () => {
    await load();
    onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Buscar</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o RUT" className={`${input} w-64 max-w-full`} />
          </label>
          <div className="flex gap-1.5" role="group" aria-label="Estado de la cuenta">
            {(["active", "inactive", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`min-h-11 rounded-full border px-3 text-sm ${status === s ? "border-fg bg-fg text-bg" : "border-line bg-surface"}`}
              >
                {s === "active" ? "Activas" : s === "inactive" ? "Desactivadas" : "Todas"}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            setCreating(true);
            setSelected(null);
          }}
          className="min-h-11 rounded-xl bg-accent px-4 font-bold text-accent-fg"
        >
          + Nueva cuenta
        </button>
      </div>

      {secret && <SecretBox {...secret} onClose={() => setSecret(null)} />}
      {creating && (
        <CreateForm
          onCancel={() => setCreating(false)}
          onCreated={async (u, pw, addedNote) => {
            setCreating(false);
            setSecret({ name: u.fullName, data: pw, note: addedNote });
            setSelected(u.id);
            await changed();
          }}
        />
      )}
      {selected && (
        <UserEditor
          key={selected}
          userId={selected}
          isMe={selected === myUserId}
          now={now}
          onClose={() => setSelected(null)}
          onChanged={changed}
          onSecret={(name, data) => setSecret({ name, data })}
        />
      )}

      {err && <p className="rounded-lg border-l-4 border-no bg-no-soft px-3 py-2 text-sm">{err}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-3 py-2.5">Nombre</th>
              <th className="px-3 py-2.5">RUT</th>
              <th className="px-3 py-2.5">Roles</th>
              <th className="px-3 py-2.5">Brigadista</th>
              <th className="px-3 py-2.5">Estado</th>
              <th className="px-3 py-2.5">Último ingreso</th>
            </tr>
          </thead>
          <tbody>
            {items === null && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  Cargando…
                </td>
              </tr>
            )}
            {items?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  Ninguna cuenta coincide.
                </td>
              </tr>
            )}
            {items?.map((u) => (
              <tr key={u.id} className={`border-t border-line align-top ${selected === u.id ? "bg-surface-2" : ""}`}>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => {
                      setSelected(u.id);
                      setCreating(false);
                    }}
                    className="text-left font-semibold text-accent underline"
                  >
                    {u.fullName}
                  </button>
                  {u.id === myUserId && <span className="ml-1.5 text-xs text-muted">(tú)</span>}
                  <div className="text-xs text-muted">{u.email ?? "sin correo"}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums">{formatRut(u.rut)}</td>
                <td className="px-3 py-2.5">
                  {u.roles.length ? u.roles.map((r) => <RoleChip key={r} role={r} />) : <span className="text-muted">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  {u.brigadista?.active ? (
                    <>
                      <span className="font-semibold text-go">✓ Sí</span>
                      <div className="whitespace-nowrap font-mono text-xs text-muted">{u.brigadista.phone ?? "sin teléfono"}</div>
                    </>
                  ) : (
                    <span className="text-muted">{u.brigadista ? "– Dado de baja" : "–"}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {u.active ? <span className="text-go">● Activa</span> : <span className="font-semibold text-alarm">■ Desactivada</span>}
                  {u.mustChangePassword && u.active && <div className="text-xs text-wait">◷ Contraseña provisoria</div>}
                </td>
                <td className="px-3 py-2.5 text-muted">{ago(u.lastLoginAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Las cuentas no se borran: se desactivan, para conservar su historial de respuestas. Una cuenta nueva entra con una contraseña provisoria (72 h) que debe cambiar al primer ingreso.
      </p>
    </div>
  );
}

function RoleChip({ role }: { role: AppRole }) {
  return <span className="mr-1 inline-block rounded border border-line px-1.5 text-xs font-semibold">{ROLE_LABEL[role]}</span>;
}

/** La contraseña provisoria se muestra una sola vez. */
function SecretBox({ name, data, note, onClose }: { name: string; data: ProvisionalPassword; note?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section role="status" className="flex flex-col gap-2 rounded-2xl border-2 border-wait bg-wait-soft p-4">
      <h3 className="font-display text-xl font-bold">Contraseña provisoria de {name}</h3>
      <p className="text-sm">
        Entrégasela en persona o por un canal seguro. <strong>No se volverá a mostrar.</strong> Vence el {dayTime(data.expiresAt)}; al primer ingreso deberá cambiarla.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xl tracking-wider select-all">{data.provisionalPassword}</code>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(data.provisionalPassword);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className="min-h-10 rounded-full border border-line bg-surface px-4"
        >
          {copied ? "✓ Copiada" : "Copiar"}
        </button>
        <button onClick={onClose} className="min-h-10 rounded-full border border-line bg-surface px-4">
          Ya la entregué, ocultar
        </button>
      </div>
      {note && <p className="text-sm font-semibold">{note}</p>}
    </section>
  );
}

function CreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (u: UserDetail, pw: ProvisionalPassword, addedNote?: string) => void;
}) {
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isBrigadista, setIsBrigadista] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const phone = String(f.get("phone") ?? "").trim();
    setBusy(true);
    setErr(null);
    try {
      const r = await admin<{ user: UserDetail; provisionalPassword: ProvisionalPassword; addedToActiveEmergency: unknown }>("POST", "users", {
        rut: String(f.get("rut")).trim(),
        fullName: String(f.get("fullName")).trim(),
        ...(email ? { email } : {}),
        roles,
        brigadista: isBrigadista ? { phone: phone || null } : null,
      });
      onCreated(r.user, r.provisionalPassword, r.addedToActiveEmergency ? "Quedó convocado a la convocatoria activa." : undefined);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border-2 border-fg bg-surface p-5 md:grid-cols-2">
      <h3 className="font-display text-xl font-bold md:col-span-2">Nueva cuenta</h3>
      <label className="flex flex-col gap-1">
        <span className={label}>RUT</span>
        <input name="rut" required maxLength={20} placeholder="12.345.678-5" className={input} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Nombre completo</span>
        <input name="fullName" required maxLength={120} placeholder="Camila Rojas" className={input} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Correo (opcional)</span>
        <input name="email" type="email" maxLength={254} placeholder="nombre@ejemplo.cl" className={input} />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className={label}>Roles en el panel</legend>
        <div className="flex flex-wrap gap-3 pt-1">
          {ROLES.map((r) => (
            <label key={r} className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={roles.includes(r)}
                onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
                className="size-5"
              />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        <span className="text-xs text-muted">Sin roles: solo usa la app como brigadista.</span>
      </fieldset>
      <label className="inline-flex min-h-11 items-center gap-2 md:col-span-2">
        <input type="checkbox" checked={isBrigadista} onChange={(e) => setIsBrigadista(e.target.checked)} className="size-5" />
        <span>
          <strong>Es brigadista</strong> <span className="text-muted">(recibe convocatorias en la app)</span>
        </span>
      </label>
      {isBrigadista && (
        <label className="flex flex-col gap-1">
          <span className={label}>Teléfono de contacto</span>
          <input name="phone" pattern="\+?[0-9 ]{8,20}" placeholder="+56 9 1234 5678" className={input} />
        </label>
      )}
      {err && <p role="alert" className="rounded-lg border-l-4 border-no bg-no-soft px-3 py-2 text-sm md:col-span-2">{err}</p>}
      {!isBrigadista && roles.length === 0 && (
        <p className="text-sm text-wait md:col-span-2">◷ Sin roles ni condición de brigadista la cuenta no podrá usar la app ni el panel.</p>
      )}
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-accent px-5 font-bold text-accent-fg disabled:opacity-60">
          {busy ? "Creando…" : "Crear cuenta"}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-line px-5">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function UserEditor({
  userId,
  isMe,
  now,
  onClose,
  onChanged,
  onSecret,
}: {
  userId: string;
  isMe: boolean;
  now: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onSecret: (name: string, data: ProvisionalPassword) => void;
}) {
  const [u, setU] = useState<UserDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "deactivate" | "brigadista-off" | "reset">(null);

  useEffect(() => {
    admin<UserDetail>("GET", `users/${userId}`).then(setU, (e: Error) => setErr(e.message));
  }, [userId]);

  async function run(fn: () => Promise<UserDetail | { user: UserDetail; addedToActiveEmergency: unknown }>, message: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await fn();
      const user = "user" in r ? r.user : r;
      setU(user);
      setOk("user" in r && r.addedToActiveEmergency ? `${message} Quedó convocado a la convocatoria activa.` : message);
      setConfirm(null);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!u) {
    return <section className="rounded-2xl border-2 border-fg bg-surface p-5 text-muted">{err ?? "Cargando cuenta…"}</section>;
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border-2 border-fg bg-surface p-5" aria-label={`Cuenta de ${u.fullName}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-2xl font-bold">
            {u.fullName} {isMe && <span className="text-base font-normal text-muted">(tú)</span>}
          </h3>
          <p className="text-sm text-muted">
            RUT <span className="font-mono">{formatRut(u.rut)}</span> · {u.active ? "Activa" : `Desactivada ${ago(u.deactivatedAt, now)}`} · último ingreso {ago(u.lastLoginAt, now)}
            {u.mustChangePassword && u.passwordExpiresAt && ` · provisoria vence ${dayTime(u.passwordExpiresAt)}`}
          </p>
        </div>
        <button onClick={onClose} className="min-h-10 rounded-full border border-line px-4">
          Cerrar
        </button>
      </div>

      {err && <p role="alert" className="rounded-lg border-l-4 border-no bg-no-soft px-3 py-2 text-sm">{err}</p>}
      {ok && <p role="status" className="rounded-lg border-l-4 border-go bg-go-soft px-3 py-2 text-sm">✓ {ok}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Datos */}
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const f = new FormData(ev.currentTarget);
            const email = String(f.get("email") ?? "").trim();
            void run(
              () => admin<UserDetail>("PATCH", `users/${u.id}`, { fullName: String(f.get("fullName")).trim(), email: email || null }),
              "Datos guardados.",
            );
          }}
        >
          <h4 className={label}>Datos</h4>
          <label className="flex flex-col gap-1 text-sm">
            Nombre completo
            <input name="fullName" defaultValue={u.fullName} required maxLength={120} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Correo
            <input name="email" type="email" defaultValue={u.email ?? ""} maxLength={254} placeholder="sin correo" className={input} />
          </label>
          <p className="text-xs text-muted">El RUT no se edita: es la identidad de acceso.</p>
          <button disabled={busy} className="min-h-10 self-start rounded-lg border border-fg px-4 font-semibold disabled:opacity-60">
            Guardar datos
          </button>
        </form>

        {/* Roles */}
        <div className="flex flex-col gap-2">
          <h4 className={label}>Roles en el panel</h4>
          {ROLES.map((r) => {
            const has = u.roles.includes(r);
            return (
              <label key={r} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={has}
                  disabled={busy}
                  onChange={() =>
                    void run(
                      () => admin<UserDetail>(has ? "DELETE" : "PUT", `users/${u.id}/roles/${r}`),
                      has ? `Rol ${ROLE_LABEL[r]} quitado.` : `Rol ${ROLE_LABEL[r]} asignado.`,
                    )
                  }
                  className="size-5"
                />
                {ROLE_LABEL[r]}
              </label>
            );
          })}
          <p className="text-xs text-muted">
            Coordinador: convocatorias y panel. Administrador: cuentas y roles. Aplica en su próxima acción, sin cerrar su sesión.
          </p>
        </div>

        {/* Brigadista */}
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const phone = String(new FormData(ev.currentTarget).get("phone") ?? "").trim();
            void run(
              () => admin<{ user: UserDetail; addedToActiveEmergency: unknown }>("PUT", `users/${u.id}/brigadista-profile`, { phone: phone || null }),
              u.brigadista?.active ? "Teléfono actualizado." : "Ahora es brigadista.",
            );
          }}
        >
          <h4 className={label}>Brigadista</h4>
          <p className="text-sm">
            {u.brigadista?.active ? (
              <span className="font-semibold text-go">✓ Recibe convocatorias</span>
            ) : (
              <span className="text-muted">{u.brigadista ? "Dado de baja como brigadista" : "No es brigadista"}</span>
            )}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Teléfono de contacto
            <input name="phone" defaultValue={u.brigadista?.phone ?? ""} pattern="\+?[0-9 ]{8,20}" placeholder="+56 9 1234 5678" className={input} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className="min-h-10 rounded-lg border border-fg px-4 font-semibold disabled:opacity-60">
              {u.brigadista?.active ? "Guardar teléfono" : "Hacer brigadista"}
            </button>
            {u.brigadista?.active && (
              <button type="button" onClick={() => setConfirm("brigadista-off")} className="min-h-10 rounded-lg border border-alarm px-4 text-alarm">
                Dar de baja como brigadista
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Acciones de cuenta */}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {u.active ? (
          <>
            <button onClick={() => setConfirm("reset")} className="min-h-10 rounded-lg border border-line px-4">
              Restablecer contraseña
            </button>
            {!isMe && (
              <button onClick={() => setConfirm("deactivate")} className="min-h-10 rounded-lg border-2 border-alarm px-4 font-semibold text-alarm">
                Desactivar cuenta
              </button>
            )}
          </>
        ) : (
          <button
            disabled={busy}
            onClick={() => void run(() => admin<{ user: UserDetail; addedToActiveEmergency: unknown }>("POST", `users/${u.id}/activate`), "Cuenta reactivada.")}
            className="min-h-10 rounded-lg bg-go px-4 font-bold text-white disabled:opacity-60"
          >
            Reactivar cuenta
          </button>
        )}
      </div>

      {confirm && (
        <ConfirmBox
          kind={confirm}
          name={u.fullName}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async (reason) => {
            if (confirm === "reset") {
              setBusy(true);
              setErr(null);
              try {
                const pw = await admin<ProvisionalPassword>("POST", `users/${u.id}/reset-password`);
                onSecret(u.fullName, pw);
                setConfirm(null);
                setU(await admin<UserDetail>("GET", `users/${u.id}`));
                await onChanged();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            } else if (confirm === "deactivate") {
              await run(() => admin<UserDetail>("POST", `users/${u.id}/deactivate`, { reason }), "Cuenta desactivada; sus sesiones se cerraron.");
            } else {
              await run(() => admin<UserDetail>("POST", `users/${u.id}/brigadista-profile/deactivate`, { reason }), "Dado de baja como brigadista.");
            }
          }}
        />
      )}
    </section>
  );
}

const CONFIRM_TEXT = {
  deactivate: {
    title: "¿Desactivar la cuenta?",
    body: "Se cierran todas sus sesiones y no podrá ingresar. Su historial se conserva y se puede reactivar.",
    action: "Sí, desactivar",
    needsReason: true,
  },
  "brigadista-off": {
    title: "¿Dar de baja como brigadista?",
    body: "Deja de recibir convocatorias nuevas. La cuenta sigue activa y conserva su historial.",
    action: "Sí, dar de baja",
    needsReason: true,
  },
  reset: {
    title: "¿Restablecer la contraseña?",
    body: "Se genera una contraseña provisoria nueva (72 h) y se cierran todas sus sesiones, también en el teléfono.",
    action: "Sí, restablecer",
    needsReason: false,
  },
} as const;

function ConfirmBox({
  kind,
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: keyof typeof CONFIRM_TEXT;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = CONFIRM_TEXT[kind];
  const [reason, setReason] = useState("");
  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-xl border-2 border-alarm bg-alarm-soft p-4">
      <p className="font-semibold">
        {t.title} <span className="font-normal">({name})</span>
      </p>
      <p className="text-sm">{t.body}</p>
      {t.needsReason && (
        <label className="flex flex-col gap-1 text-sm">
          Motivo (queda en el registro de auditoría)
          <input id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={`${input} bg-surface`} />
        </label>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(reason.trim())}
          disabled={busy || (t.needsReason && !reason.trim())}
          className="min-h-10 flex-1 rounded-lg bg-alarm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Procesando…" : t.action}
        </button>
        <button onClick={onCancel} className="min-h-10 flex-1 rounded-lg border border-line bg-surface">
          Volver
        </button>
      </div>
    </div>
  );
}

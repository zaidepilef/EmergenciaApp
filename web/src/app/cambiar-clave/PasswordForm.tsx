"use client";

import { useActionState } from "react";
import { changePasswordAction, logoutAction, type PasswordState } from "../actions";

const initial: PasswordState = { error: null };

const fields = [
  { id: "currentPassword", label: "Contraseña provisoria o actual", autoComplete: "current-password" },
  { id: "newPassword", label: "Contraseña nueva", autoComplete: "new-password" },
  { id: "repeatPassword", label: "Repite la contraseña nueva", autoComplete: "new-password" },
];

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initial);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
        {fields.map((f) => (
          <label key={f.id} className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">{f.label}</span>
            <input
              id={f.id}
              name={f.id}
              type="password"
              autoComplete={f.autoComplete}
              required
              minLength={f.id === "currentPassword" ? 1 : 10}
              maxLength={128}
              className="min-h-12 rounded-xl border border-line bg-surface-2 px-3 text-lg"
            />
          </label>
        ))}
        {state.error && (
          <p role="alert" className="rounded-lg border-l-4 border-no bg-no-soft px-3 py-2 text-sm">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="min-h-12 rounded-xl bg-accent text-lg font-bold text-accent-fg disabled:opacity-60">
          {pending ? "Guardando…" : "Guardar y entrar"}
        </button>
      </form>
      <form action={logoutAction}>
        <button className="min-h-10 w-full text-sm text-muted underline">Salir sin cambiarla</button>
      </form>
    </div>
  );
}

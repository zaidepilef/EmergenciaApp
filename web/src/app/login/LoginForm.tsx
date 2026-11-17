"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "../actions";

const initial: LoginState = { error: null, rut: "" };

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">RUT</span>
        <input
          id="rut"
          name="rut"
          defaultValue={state.rut}
          placeholder="12.345.678-5"
          autoComplete="username"
          required
          className="min-h-12 rounded-xl border border-line bg-surface-2 px-3 text-lg"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Contraseña</span>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-12 rounded-xl border border-line bg-surface-2 px-3 text-lg"
        />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg border-l-4 border-no bg-no-soft px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-xl bg-accent text-lg font-bold text-accent-fg disabled:opacity-60"
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}

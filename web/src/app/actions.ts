"use server";

import { redirect } from "next/navigation";
import { ApiError, login, logout } from "@/lib/api";

export interface LoginState {
  error: string | null;
  rut: string;
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const rut = String(form.get("rut") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!rut || !password) return { error: "Ingresa tu RUT y tu contraseña.", rut };
  try {
    const me = await login(rut, password);
    if (!me.capabilities.includes("COORD") && !me.capabilities.includes("ADMIN")) {
      await logout();
      return { error: "Tu cuenta no tiene acceso al panel. El panel es para coordinadores y administradores.", rut };
    }
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "UNKNOWN";
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: "RUT o contraseña incorrectos.",
      VALIDATION_ERROR: "Revisa el RUT: el formato o el dígito verificador no corresponde.",
      RATE_LIMITED: "Demasiados intentos. Espera unos minutos.",
      API_UNREACHABLE: "No se pudo conectar con el servidor. Revisa que la API esté corriendo.",
    };
    return { error: messages[code] ?? "No se pudo iniciar sesión. Intenta de nuevo.", rut };
  }
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

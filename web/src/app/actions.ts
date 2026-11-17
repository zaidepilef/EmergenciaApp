"use server";

import { redirect } from "next/navigation";
import { ApiError, changePassword, login, logout } from "@/lib/api";

export interface LoginState {
  error: string | null;
  rut: string;
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const rut = String(form.get("rut") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!rut || !password) return { error: "Ingresa tu RUT y tu contraseña.", rut };
  let mustChange = false;
  try {
    const { me, mustChangePassword } = await login(rut, password);
    if (!me.capabilities.includes("COORD") && !me.capabilities.includes("ADMIN")) {
      await logout();
      return { error: "Tu cuenta no tiene acceso al panel. El panel es para coordinadores y administradores.", rut };
    }
    mustChange = mustChangePassword;
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
  // redirect() lanza una excepción: va fuera del try.
  redirect(mustChange ? "/cambiar-clave" : "/");
}

export interface PasswordState {
  error: string | null;
}

export async function changePasswordAction(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const current = String(form.get("currentPassword") ?? "");
  const next = String(form.get("newPassword") ?? "");
  const repeat = String(form.get("repeatPassword") ?? "");
  if (next.length < 10) return { error: "La contraseña nueva debe tener al menos 10 caracteres." };
  if (next !== repeat) return { error: "Las contraseñas nuevas no coinciden." };
  try {
    await changePassword(current, next);
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "UNKNOWN";
    if (code === "UNAUTHENTICATED") redirect("/login");
    const messages: Record<string, string> = {
      CURRENT_PASSWORD_INVALID: "La contraseña actual (o provisoria) no corresponde.",
      PASSWORD_POLICY: "La contraseña no puede contener tu RUT.",
      PASSWORD_REUSED: "La contraseña nueva debe ser distinta de la actual.",
      RATE_LIMITED: "Demasiados intentos. Espera unos minutos.",
      VALIDATION_ERROR: "La contraseña debe tener entre 10 y 128 caracteres.",
      API_UNREACHABLE: "No se pudo conectar con el servidor.",
    };
    return { error: messages[code] ?? "No se pudo cambiar la contraseña. Intenta de nuevo." };
  }
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

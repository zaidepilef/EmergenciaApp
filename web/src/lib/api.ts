// BFF: única puerta del dashboard a la API. Solo corre en el servidor de
// Next.js; los tokens viven en cookies httpOnly y el navegador nunca los ve.
import "server-only";
import { cookies } from "next/headers";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const ACCESS = "ea_at";
const REFRESH = "ea_rt";
const secure = process.env.NODE_ENV === "production";

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function raw(method: string, path: string, body?: unknown, token?: string) {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(503, "API_UNREACHABLE");
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

export async function storeTokens(t: AuthTokens) {
  const jar = await cookies();
  const base = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
  jar.set(ACCESS, t.accessToken, { ...base, expires: new Date(t.accessTokenExpiresAt) });
  jar.set(REFRESH, t.refreshToken, { ...base, expires: new Date(t.refreshTokenExpiresAt) });
}

export async function clearTokens() {
  const jar = await cookies();
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

export async function hasSession() {
  return (await cookies()).has(REFRESH);
}

/** Login web: `clientType: WEB`, sesión de 12 h (D-B2). */
export async function login(rut: string, password: string) {
  const r = await raw("POST", "/v1/auth/login", { clientType: "WEB", rut, password });
  if (r.status !== 200) throw new ApiError(r.status, r.json?.code ?? "UNKNOWN");
  await storeTokens(r.json.tokens);
  return r.json.me as { fullName: string; roles: string[]; capabilities: string[] };
}

async function refresh(): Promise<string> {
  const jar = await cookies();
  const rt = jar.get(REFRESH)?.value;
  if (!rt) throw new ApiError(401, "UNAUTHENTICATED");
  const r = await raw("POST", "/v1/auth/refresh", { refreshToken: rt });
  if (r.status === 200) {
    await storeTokens(r.json);
    return r.json.accessToken as string;
  }
  // REFRESH_RACE: otra petición ya renovó; el navegador tendrá la cookie nueva en el próximo sondeo.
  if (r.status === 409) throw new ApiError(503, "REFRESH_RACE");
  await clearTokens();
  throw new ApiError(401, "UNAUTHENTICATED");
}

/**
 * Llama a la API con el token de la cookie; si venció, renueva una vez y
 * reintenta. Solo usar desde Route Handlers o Server Actions (escriben cookies).
 */
export async function callApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const jar = await cookies();
  let token = jar.get(ACCESS)?.value;
  if (!token) token = await refresh();
  let r = await raw(method, path, body, token);
  if (r.status === 401) {
    token = await refresh();
    r = await raw(method, path, body, token);
  }
  if (r.status >= 400) throw new ApiError(r.status, r.json?.code ?? "UNKNOWN");
  return r.json as T;
}

export async function logout() {
  try {
    await callApi("POST", "/v1/auth/logout");
  } catch {
    // la sesión se cierra igual en el navegador
  }
  await clearTokens();
}

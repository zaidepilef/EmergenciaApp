import "server-only";
import { ApiError } from "./api";

/** Las mutaciones solo se aceptan desde el mismo origen (cookies SameSite=Lax + verificación de Origin). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return Response.json({ code: e.code }, { status: e.status });
  console.error(e);
  return Response.json({ code: "INTERNAL_ERROR" }, { status: 500 });
}

export const forbiddenOrigin = () => Response.json({ code: "FORBIDDEN_ORIGIN" }, { status: 403 });

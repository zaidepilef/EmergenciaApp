import { callApi } from "@/lib/api";
import { errorResponse, forbiddenOrigin, sameOrigin } from "@/lib/bff";

export const dynamic = "force-dynamic";

// Solo las rutas de administración del contrato (tag `admin`); todo lo demás es 404.
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED: Record<string, RegExp[]> = {
  GET: [/^users$/, new RegExp(`^users/${ID}$`)],
  POST: [/^users$/, new RegExp(`^users/${ID}/(deactivate|activate|reset-password|brigadista-profile/deactivate)$`)],
  PATCH: [new RegExp(`^users/${ID}$`)],
  PUT: [new RegExp(`^users/${ID}/(roles/(ADMINISTRADOR|COORDINADOR)|brigadista-profile)$`)],
  DELETE: [new RegExp(`^users/${ID}/roles/(ADMINISTRADOR|COORDINADOR)$`)],
};
const QUERY_KEYS = ["q", "active", "role", "cursor", "limit"];

async function handle(req: Request, params: Promise<{ path: string[] }>) {
  const path = (await params).path.join("/");
  if (!(ALLOWED[req.method] ?? []).some((re) => re.test(path))) {
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  }
  if (req.method !== "GET" && !sameOrigin(req)) return forbiddenOrigin();

  let target = `/v1/${path}`;
  if (req.method === "GET") {
    const incoming = new URL(req.url).searchParams;
    const qs = new URLSearchParams();
    for (const k of QUERY_KEYS) {
      const v = incoming.get(k);
      if (v) qs.set(k, v);
    }
    if ([...qs].length) target += `?${qs}`;
  }
  const hasBody = ["POST", "PATCH", "PUT"].includes(req.method);
  const text = hasBody ? await req.text() : "";
  try {
    const result = await callApi(req.method, target, text ? JSON.parse(text) : undefined);
    // Las contraseñas provisorias se muestran una sola vez: nunca en caché.
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export const GET = (req: Request, ctx: Ctx) => handle(req, ctx.params);
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx.params);
export const PATCH = (req: Request, ctx: Ctx) => handle(req, ctx.params);
export const PUT = (req: Request, ctx: Ctx) => handle(req, ctx.params);
export const DELETE = (req: Request, ctx: Ctx) => handle(req, ctx.params);

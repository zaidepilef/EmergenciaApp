import { randomUUID } from "node:crypto";
import { callApi } from "@/lib/api";
import { errorResponse, forbiddenOrigin, sameOrigin } from "@/lib/bff";

interface Body {
  /** Generado por el navegador al abrir el formulario: un reintento no duplica la convocatoria. */
  id?: string;
  emergencyType: string;
  meetingPoint: string;
  scheduledAt: string;
  instructions?: string;
}

/** Crear el borrador y activarlo: convoca a todos los brigadistas activos. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  try {
    const b = (await req.json()) as Body;
    const id = b.id ?? randomUUID();
    await callApi("POST", "/v1/emergencies", {
      id,
      emergencyType: b.emergencyType.trim(),
      meetingPoint: b.meetingPoint.trim(),
      scheduledAt: new Date(b.scheduledAt).toISOString(),
      ...(b.instructions?.trim() ? { instructions: b.instructions.trim() } : {}),
    });
    const result = await callApi("POST", `/v1/emergencies/${id}/activate`);
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

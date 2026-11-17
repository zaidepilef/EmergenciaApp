import { callApi } from "@/lib/api";
import { errorResponse } from "@/lib/bff";
import type { AvailabilityChange } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Historial de disponibilidad de un brigadista (últimos 50 cambios). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return Response.json({ code: "VALIDATION_ERROR" }, { status: 400 });
  try {
    const page = await callApi<{ items: AvailabilityChange[]; nextCursor: string | null }>(
      "GET",
      `/v1/brigadistas/${id}/availability-history?limit=50`,
    );
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

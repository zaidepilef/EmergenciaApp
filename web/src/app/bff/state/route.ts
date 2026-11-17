import { callApi } from "@/lib/api";
import { errorResponse } from "@/lib/bff";
import type { ActiveEmergencySummary, AvailabilityCounts, BrigadistaSummary, DashboardState, Me, Notice, RecipientStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Un solo sondeo (cada 10 s) con todo lo que muestra el panel. Las llamadas a
 * la API van en serie para renovar el token a lo sumo una vez.
 */
export async function GET() {
  try {
    const me = await callApi<Me>("GET", "/v1/me");
    const summary = await callApi<ActiveEmergencySummary>("GET", "/v1/emergencies/active/summary");
    let recipients: RecipientStatus[] = [];
    let notices: Notice[] = [];
    let instructions: string | null = null;
    if (summary.emergency) {
      const id = summary.emergency.id;
      recipients = (await callApi<{ items: RecipientStatus[] }>("GET", `/v1/emergencies/${id}/recipients`)).items;
      const detail = await callApi<{ emergency: { instructions: string | null }; notices: Notice[] }>("GET", `/v1/emergencies/${id}`);
      notices = detail.notices;
      instructions = detail.emergency.instructions;
    }
    const brigadistas = (await callApi<{ items: BrigadistaSummary[] }>("GET", "/v1/brigadistas")).items;
    const { availability } = await callApi<{ availability: AvailabilityCounts }>("GET", "/v1/dashboard/summary");
    const state: DashboardState = { me, summary, recipients, notices, instructions, brigadistas, availability };
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

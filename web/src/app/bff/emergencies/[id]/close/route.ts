import { callApi } from "@/lib/api";
import { errorResponse, forbiddenOrigin, sameOrigin } from "@/lib/bff";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { message?: string };
    const message = body.message?.trim();
    const result = await callApi("POST", `/v1/emergencies/${encodeURIComponent(id)}/close`, message ? { message } : {});
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

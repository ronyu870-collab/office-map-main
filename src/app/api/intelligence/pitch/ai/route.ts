import { after } from "next/server";
import { handleAiRequest } from "@/src/lib/pitch/ai/http";
import { pitchDependencies } from "@/src/lib/pitch/data/store";
/** Source-version policy, lease, budget and audit checks are enforced atomically by pitch_studio_access. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    return await handleAiRequest(request, pitchDependencies(), (work) =>
      after(work),
    );
  } catch {
    return Response.json(
      { error: "Pitch Studio 尚未配置。" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

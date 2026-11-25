import { after } from "next/server";
import { handleWorkspaceRequest } from "@/src/lib/pitch/workspace/http";
import { pitchDependencies } from "@/src/lib/pitch/data/store";
/** pitch_studio_access atomically validates owner, original sources and version before every editor mutation. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    return await handleWorkspaceRequest(request, pitchDependencies(), (task) =>
      after(task),
    );
  } catch {
    return Response.json(
      { error: "Pitch Studio 尚未配置。" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
export const POST = GET;

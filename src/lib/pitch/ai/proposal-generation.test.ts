import { describe, expect, it, vi } from "vitest";
import { generateBusinessProject } from "../business/workflow";
import type { Generation } from "../business/protocol";
import type { PitchContext } from "../data/store";
import { STUDIO_THEME } from "../design/theme";
import { layoutFixture } from "../fixtures/layouts";

const calls = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock("../data/store", async importOriginal => ({ ...await importOriginal<typeof import("../data/store")>(), pitchRpc: calls.rpc }));
vi.mock("../business/adapter", async importOriginal => ({ ...await importOriginal<typeof import("../business/adapter")>(), runPitchDataAdapter: calls.read }));

const projectId = "10000000-0000-4000-8000-000000000140";
const buildingId = "10000000-0000-4000-8000-000000000141";
const quarter = { year: 2026, quarter: 2 } as const;
const context = { signal: new AbortController().signal } as PitchContext;
const command: Generation = {
  action: "generate", projectId, title: "合成报告", scope: { organizationId: "test", region: "华北", city: "北京", businessLine: "office" },
  language: "zh", themeId: STUDIO_THEME.id, themeVersion: STUDIO_THEME.version,
  parts: [{ mode: "dynamic", parameters: { templateId: "building-profile", buildingIds: [buildingId], submarkets: [],
    inventory: "tracked", period: quarter, start: quarter, end: quarter, direction: "desc", fields: ["height"], chart: "table",
    from: "2026-04-01", to: "2026-06-30", leaseSource: "combined", measure: "count" } }],
};

function fixture() {
  calls.rpc.mockReset().mockImplementation(async (_ctx, request) => request.action === "registry"
    ? { theme: { definition: STUDIO_THEME } } : { projectId });
  calls.read.mockReset().mockResolvedValue({ dataVersion: "fresh", content: [layoutFixture("data-table")] });
}

describe("reviewed generation pre-commit guard", () => {
  it("composes real slides and refuses a changed source before the first write", async () => {
    fixture();
    await expect(generateBusinessProject(context, command, undefined, undefined, false, snapshots => {
      if (snapshots[0].dataVersion !== "reviewed") throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
    })).rejects.toThrow("PITCH_PROPOSAL_REVIEW_REQUIRED");
    expect(calls.read).toHaveBeenCalledOnce();
    expect(calls.rpc.mock.calls.map(([, input]) => input.action)).toEqual(["registry"]);
  }, 30_000);

  it("passes the original commit payload through the existing write path after verification", async () => {
    fixture();
    await expect(generateBusinessProject(context, command, undefined, undefined, false, snapshots => {
      expect(snapshots[0].dataVersion).toBe("fresh");
    })).resolves.toEqual({ projectId });
    const payload = calls.rpc.mock.calls.find(([, request]) => request.action === "business_generate_commit")?.[1];
    expect(payload.slides).toEqual(expect.arrayContaining([expect.objectContaining({ scene: expect.any(Object), content: expect.any(Object) })]));
  }, 30_000);
});

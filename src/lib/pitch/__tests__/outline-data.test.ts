import { expect, it } from "vitest";
import { outlineDataParameters } from "../workspace/protocol";
import { reviewedBuildingData } from "../business/outline-data";
import type { PitchDataSnapshot } from "../business/adapter";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const parameters = outlineDataParameters([id, other], "2026-Q3");
function snapshot(): PitchDataSnapshot {
  return {
    adapter: "pitch-data/1", parameters, plans: [], capturedAt: "2026-11-27", dataVersion: "snapshot", dataAsOf: "2026-09-30",
    binding: { domain: "quarter", policyVersion: "1", permissionRevision: "1" },
    content: [],
    results: [{
      registryVersion: "1", snapshotId: id, resultId: id, createdAt: "2026-11-27", dataVersion: "fresh",
      scopeFingerprint: "scope", operation: "list", parameters: {}, analysis: null, limitations: [],
      sources: [id, other].map(entityId => ({
        id: entityId, entityId, kind: "record", table: "building_metrics", recordId: entityId, field: "total_area",
        recordVersion: "1", rawValue: 8500, unit: "m2", period: { year: 2026, quarter: 3 },
        recordedAt: null, businessAsOf: null, original: null, verification: "database_only",
      })),
      table: { id: "list", columns: [{ key: "name", label: "楼宇", unit: null }], rows: [
        { entityId: id, cells: { name: { kind: "text", value: "第一座", sourceIds: [] } } },
        { entityId: other, cells: { name: { kind: "text", value: "第二座", sourceIds: [] } } },
      ] },
    }],
  };
}

it("pins reviewed evidence instead of random receipt IDs and detects data and authority changes", () => {
  const before = reviewedBuildingData(snapshot());
  const after = snapshot();
  after.capturedAt = "2026-11-28";
  after.results[0].snapshotId = other;
  after.results[0].dataVersion = "new";
  after.results[0].sources.reverse();
  after.results[0].table.rows.reverse();
  expect(reviewedBuildingData(after)).toEqual(before);
  after.results[0].sources[0].rawValue = 9000;
  expect(reviewedBuildingData(after).fingerprint).not.toBe(before.fingerprint);
  const changedGrant = snapshot();
  changedGrant.binding.permissionRevision = "2";
  expect(reviewedBuildingData(changedGrant).fingerprint).not.toBe(before.fingerprint);
});

it("rejects partial or wrong-quarter coverage without listing the denied buildings", () => {
  const invalid = snapshot();
  invalid.results[0].sources[0].period = { year: 2026, quarter: 2 };
  expect(() => reviewedBuildingData(invalid)).toThrow("PITCH_OUTLINE_DATA_CHANGED");
  invalid.results[0].sources[0].period = { year: 2026, quarter: 3 };
  invalid.results[0].table.rows.pop();
  expect(() => reviewedBuildingData(invalid)).toThrow("PITCH_OUTLINE_DATA_CHANGED");
});

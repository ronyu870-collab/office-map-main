import assert from 'node:assert/strict';

// This is the fixture's disclosure contract, not a search across protocol IDs:
// Stacking may send counts/schema, never private row values or table previews.
export function assertStackingModelObservation(observation) {
  const fields = ['status', 'resultId', 'dataDomain', 'rowCount', 'columns', 'limitations', 'note'];
  const hasWorkset = Object.hasOwn(observation, 'workset');
  assert.deepEqual(Object.keys(observation).sort(), [...fields, ...(hasWorkset ? ['workset'] : [])].sort(), 'Stacking observation contains private or unexpected fields');
  assert.equal(observation.status, 'ready');
  assert.equal(observation.dataDomain, 'business-research/1');
  if (hasWorkset) {
    assert.ok(observation.workset && typeof observation.workset === 'object' && !Array.isArray(observation.workset));
    const metadata = ['requestId', 'resultId', 'operation', 'rowCount', 'columnCount', 'sourceCount', 'snapshotId', 'dataVersion', 'scopeFingerprint', 'createdAt'];
    assert.deepEqual(Object.keys(observation.workset).sort(), metadata.sort(), 'Workset must contain metadata only');
  }
  const readable = JSON.stringify({ columns: observation.columns, limitations: observation.limitations, note: observation.note });
  for (const value of ['1001', '600', '合成租户_不得传播', '合成保密备注']) assert.equal(readable.includes(value), false, 'Private fixture values must not reach model-readable text');
}

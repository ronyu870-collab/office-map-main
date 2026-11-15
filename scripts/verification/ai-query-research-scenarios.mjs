import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

/** Loaded by the existing disposable GoTrue/PostgREST/PG17/Next HTTP gate. */
export async function verifyResearchAnalysis({ db, check, queryAdmin, call, recover, artifact, exportCaps }) {
  await grantQuery({ setup: db }, queryAdmin.id, { capabilities: exportCaps });
  const query = question => call(queryAdmin, { idempotencyKey: randomUUID(), question });
  let resultResponse;
  await check('P1研究计算：真实SQL趋势同时保留各期/共同样本、分母和未舍入变化', async () => {
    const response = await query('CBD净有效租金2026Q2至2026Q3趋势各期样本');
    assert.equal(response.status, 200);
    resultResponse = response.body;
    const research = response.body.result.parameters.researchAnalysis;
    assert.equal(research.version, 'research-analysis/1');
    const series = research.series[0];
    assert.deepEqual(series.periods.map(period => period.usedCount), [4, 3]);
    assert.deepEqual(series.periods.map(period => period.denominator.numeric), [70000, 50000]);
    assert.deepEqual(series.overall.difference.exact, { numerator: '100', denominator: '7' });
    assert.deepEqual(series.overall.change.exact, { numerator: '1000', denominator: '109' });
    assert.deepEqual(series.commonSample.map(period => period.value.numeric), [154, 170]);
    assert.deepEqual(series.comparability[0].commonSample.change.exact, { numerator: '800', denominator: '77' });
    assert.deepEqual(series.comparability[0].exitedEntityIds, [BUILDINGS[2]]);
    assert.equal(series.comparability[0].commonCount, 3);
    const vacancy = await query('CBD空置率2026Q2至2026Q3趋势全期间共同样本');
    assert.equal(vacancy.status, 200);
    assert.equal(vacancy.body.result.parameters.researchAnalysis.series[0].overall.changeUnit, 'percentage_point');
    assert.equal(vacancy.body.result.parameters.researchAnalysis.series[0].overall.change.numeric, 5);
  });
  await check('P1可信来源：研究结论、原记录、恢复与CSV归档为同一不可变快照', async () => {
    const result = resultResponse.result, research = result.parameters.researchAnalysis;
    const sourceIds = new Set(result.sources.map(source => source.id));
    for (const finding of research.findings) assert.ok(finding.sourceIds.every(id => sourceIds.has(id)));
    const restored = await recover(queryAdmin, resultResponse.requestId);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body.result.parameters.researchAnalysis, research);
    const file = await artifact(queryAdmin, { requestId: resultResponse.requestId, resultId: result.resultId, action: 'export', format: 'csv_zip' });
    assert.equal(file.status, 200);
    const zip = await JSZip.loadAsync(file.bytes), manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.deepEqual(manifest.parameters.researchAnalysis, research);
    assert.deepEqual(manifest.sources, result.sources);
  });
  await check('P1质量提醒：同楼180→80触发30%规则，来源能定位且记录未被删除', async () => {
    await db.query('update public.building_metrics set net_effective_rent=80 where building_id=$1 and record_year=2026 and record_quarter=3', [BUILDINGS[1]]);
    try {
      const response = await query('CBD净有效租金2026Q2至2026Q3趋势各期样本');
      assert.equal(response.status, 200);
      const result = response.body.result, series = result.parameters.researchAnalysis.series[0];
      const anomaly = series.anomalies.find(item => item.rule === 'entity_qoq_rent_30_percent' && item.entityId === BUILDINGS[1]);
      assert.ok(anomaly);
      assert.equal(anomaly.baseValue.numeric, 180);
      assert.equal(anomaly.value.numeric, 80);
      assert.deepEqual(anomaly.change.exact, { numerator: '-500', denominator: '9' });
      assert.equal(anomaly.threshold.numeric, 30);
      assert.ok(series.periods[1].usedEntityIds.includes(BUILDINGS[1]));
      const source = result.sources.find(item => item.entityId === BUILDINGS[1] && item.field === 'net_effective_rent' && item.period?.quarter === 3);
      assert.ok(source && anomaly.sourceIds.includes(source.id));
      const stored = await db.query('select net_effective_rent::text value from public.building_metrics where id=$1', [source.recordId]);
      assert.equal(Number(stored.rows[0].value), 80);
      assert.match(result.parameters.researchAnalysis.findings.find(item => item.id.endsWith('/anomalies')).text, /提醒不代表数据错误/);
      const restored = await recover(queryAdmin, response.body.requestId);
      assert.equal(restored.status, 200);
      assert.deepEqual(restored.body.result, result);
    } finally {
      await db.query('update public.building_metrics set net_effective_rent=200 where building_id=$1 and record_year=2026 and record_quarter=3', [BUILDINGS[1]]);
    }
  });
  await check('P1缺数保护：缺期不伪造数值或同比，分类和市场全集限制保留', async () => {
    const response = await query('CBD净有效租金2026Q1至2026Q4趋势各期样本');
    assert.equal(response.status, 200);
    const result = response.body.result, series = result.parameters.researchAnalysis.series[0];
    assert.deepEqual(series.periods.map(period => period.value?.numeric ?? null), [null, 1090 / 7, 170, null]);
    assert.equal(series.overall.change, null);
    assert.equal(series.direction, 'incomplete');
    assert.deepEqual(series.yearOnYear, []);
    assert.equal(series.classificationTime, 'current_catalog');
    assert.match(result.limitations.join(''), /不代表.*历史楼宇全集|不代表现实市场全集/);
  });
}

import assert from 'node:assert/strict';

export const CROSS_TREND_METRICS = ['rent', 'vacancy', 'totalArea'];

export function exactFractionMatches(cell, numerator, denominator = '1') {
  const exact = cell?.value?.exact;
  const parts = value => {
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
    const [whole, decimal = ''] = String(value).split('.');
    return [BigInt(whole + decimal), 10n ** BigInt(decimal.length)];
  };
  const n = parts(numerator), d = parts(denominator);
  return cell?.kind === 'number' && /^-?\d+$/.test(exact?.numerator) && /^\d+$/.test(exact?.denominator)
    && n !== null && d !== null && d[0] !== 0n && BigInt(exact.denominator) > 0n
    && BigInt(exact.numerator) * n[1] * d[0] === n[0] * d[1] * BigInt(exact.denominator);
}

/** Independent SQL over explicitly identified synthetic buildings. No application
 * formula, grouping, period formatter or result builder is imported here. Each
 * metric's paired membership is computed separately over the complete period
 * grid; absent quarters cannot silently drop out of that intersection. */
export async function crossTrendOracleRows(db, { ids, periods, mode, submarkets = null }) {
  assert.ok(ids.length > 0 && periods.length >= 2 && periods.length <= 40, 'CROSS_TREND_ORACLE_FIXTURE_INVALID');
  assert.ok(['per_period', 'paired'].includes(mode), 'CROSS_TREND_ORACLE_FIXTURE_INVALID');
  return (await db.query(`with catalog as (
    select id,case when btrim(submarket)='' then null else submarket end submarket,
      case when btrim(grade)='' then null else grade end grade from public.buildings
    where id=any($1::uuid[]) and ($3::text[] is null or submarket=any($3::text[]))
  ), periods as (
    select (v->>'year')::int as year,(v->>'quarter')::int as quarter from jsonb_array_elements($2::jsonb) v
  ), observations as (
    select b.id,b.submarket,b.grade,p.year,p.quarter,m.total_area,m.net_effective_rent,m.vacant_area,
      coalesce(m.total_area>0 and m.net_effective_rent>0,false) rent_valid,
      coalesce(m.total_area>0 and m.vacant_area>=0 and m.vacant_area<=m.total_area,false) vacancy_valid,
      coalesce(m.total_area>0,false) area_valid
    from catalog b cross join periods p left join public.building_metrics m
      on m.building_id=b.id and m.record_year=p.year and m.record_quarter=p.quarter and not m.is_draft
  ), common as (
    select id,bool_and(rent_valid) rent_all,bool_and(vacancy_valid) vacancy_all,bool_and(area_valid) area_all
    from observations group by id
  ), selected as (
    select o.*,rent_valid and ($4::text='per_period' or rent_all) rent_used,
      vacancy_valid and ($4::text='per_period' or vacancy_all) vacancy_used,
      area_valid and ($4::text='per_period' or area_all) area_used
    from observations o join common using(id)
  ), markets as (select distinct submarket from catalog union select unnest($3::text[])),
  grades as (select distinct grade from catalog)
  select a.submarket,g.grade,p.year || '-Q' || p.quarter period,count(o.id)::int candidate_count,
    sum(o.total_area::numeric*o.net_effective_rent::numeric) filter(where o.rent_used)::text rent_numerator,
    coalesce(sum(o.total_area::numeric) filter(where o.rent_used),0)::text rent_denominator,
    count(*) filter(where o.rent_used)::int rent_count,count(*) filter(where o.rent_valid)::int rent_available,
    sum(o.vacant_area::numeric) filter(where o.vacancy_used)::text vacancy_numerator,
    coalesce(sum(o.total_area::numeric) filter(where o.vacancy_used),0)::text vacancy_denominator,
    count(*) filter(where o.vacancy_used)::int vacancy_count,count(*) filter(where o.vacancy_valid)::int vacancy_available,
    sum(o.total_area::numeric) filter(where o.area_used)::text "totalArea_numerator",
    count(*) filter(where o.area_used)::text "totalArea_denominator",
    count(*) filter(where o.area_used)::int "totalArea_count",count(*) filter(where o.area_valid)::int "totalArea_available"
  from markets a cross join grades g cross join periods p left join selected o
    on o.submarket is not distinct from a.submarket and o.grade is not distinct from g.grade
      and o.year=p.year and o.quarter=p.quarter
  group by a.submarket,g.grade,p.year,p.quarter order by a.submarket nulls last,g.grade nulls last,p.year,p.quarter`,
  [ids, JSON.stringify(periods), submarkets, mode])).rows;
}

export function validateCrossTrendResult(result, rows, metrics = CROSS_TREND_METRICS) {
  assert.equal(result.operation, 'cross_trend', 'CROSS_TREND_ORACLE_PLAN_MISMATCH');
  assert.equal(result.parameters.tableVersion, 'cross-trend/1', 'CROSS_TREND_ORACLE_PLAN_MISMATCH');
  assert.deepEqual(result.parameters.metrics ?? [result.parameters.metric], metrics, 'CROSS_TREND_ORACLE_PLAN_MISMATCH');
  assert.equal(result.table.rows.length, rows.length, 'CROSS_TREND_ORACLE_ROW_COUNT_MISMATCH');
  const seen = new Set(), sources = new Set(result.sources.map(source => source.id));
  assert.equal(sources.size, result.sources.length, 'CROSS_TREND_ORACLE_SOURCE_MISMATCH');
  const expectedMarkets = new Set(rows.map(row => row.submarket)), expectedGrades = new Set(rows.map(row => row.grade));
  for (const [name, expected] of [['rowGroups', expectedMarkets], ['columnGroups', expectedGrades]]) {
    const actual = result.parameters[name].map(group => group.value);
    assert.equal(actual.length, expected.size, 'CROSS_TREND_ORACLE_DIMENSION_MISMATCH');
    assert.deepEqual(new Set(actual), expected, 'CROSS_TREND_ORACLE_DIMENSION_MISMATCH');
  }
  for (const row of result.table.rows) {
    const independent = rows.find(expected => row.cells.name?.value === (expected.submarket ?? '未知（子市场未填写）')
      && row.cells.grade?.value === (expected.grade ?? '未知（等级未填写）') && row.cells.period?.value === expected.period);
    assert.ok(independent && !seen.has(independent), 'CROSS_TREND_ORACLE_DIMENSION_MISMATCH'); seen.add(independent);
    assert.ok(row.entityId.endsWith('/' + independent.period), 'CROSS_TREND_ORACLE_DIMENSION_MISMATCH');
    for (const [index, metric] of metrics.entries()) {
      const keys = ['value', 'usedCount', 'availableCount', 'denominator', 'coverage'];
      const columns = metrics.length > 1 ? result.parameters.metricColumns?.[metric] : Object.fromEntries(keys.map(key => [key, key]));
      assert.ok(columns && keys.every(key => columns[key] === (index === 0 ? key : `${metric}_${key}`)), 'CROSS_TREND_ORACLE_PLAN_MISMATCH');
      const count = independent[metric + '_count'], cell = row.cells[columns.value];
      if (count === 0) assert.equal(cell?.kind, 'unknown', 'CROSS_TREND_ORACLE_VALUE_MISMATCH');
      else assert.ok(exactFractionMatches(cell, independent[metric + '_numerator'], metric === 'totalArea' ? '1' : independent[metric + '_denominator']), 'CROSS_TREND_ORACLE_VALUE_MISMATCH');
      assert.ok(exactFractionMatches(row.cells[columns.usedCount], String(count)), 'CROSS_TREND_ORACLE_COUNT_MISMATCH');
      assert.ok(exactFractionMatches(row.cells[columns.availableCount], String(independent[metric + '_available'])), 'CROSS_TREND_ORACLE_COUNT_MISMATCH');
      assert.ok(exactFractionMatches(row.cells[columns.denominator], independent[metric + '_denominator']), 'CROSS_TREND_ORACLE_DENOMINATOR_MISMATCH');
      assert.ok(row.cells[columns.coverage]?.value?.includes(`候选 ${independent.candidate_count}`), 'CROSS_TREND_ORACLE_COUNT_MISMATCH');
    }
    for (const cell of Object.values(row.cells)) assert.ok(cell.sourceIds.every(id => sources.has(id)), 'CROSS_TREND_ORACLE_SOURCE_MISMATCH');
  }
}

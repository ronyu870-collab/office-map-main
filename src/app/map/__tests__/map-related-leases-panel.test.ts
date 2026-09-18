import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/app/map/MapLeaseTransactionsBridge.tsx', 'utf8');

describe('map related deals presentation contract', () => {
  it('uses a compact InfoWindow action instead of rendering lease rows inside the InfoWindow', () => {
    expect(source).toContain("const RELATED_ACTION_LABEL = '关联成交';");
    expect(source).toContain("ACTION_MODULES.findIndex(module => module.id === 'latest-sales')");
    expect(source).toContain('button.dataset.mapAction = RELATED_ACTION_ID');
    expect(source).not.toContain('data-lease-read-panel');
    expect(source).not.toContain('正在读取租赁成交');
  });

  it('opens a dedicated associated-deals panel and preserves governed building-id reads', () => {
    expect(source).toContain('aria-label={`${context.buildingName || \'当前楼宇\'}关联成交`}');
    expect(source).toContain('building_id: buildingId');
    expect(source).toContain('limit: String(PAGE_SIZE)');
    expect(source).toContain('offset: String(page * PAGE_SIZE)');
    expect(source).toContain('const PAGE_SIZE = 50;');
    expect(source).toContain('当前成交库');
    expect(source).toContain('历史成交库');
  });

  it('separates broker-scan fields instead of mixing industry and demand semantics', () => {
    expect(source).toContain('summaryIndustry(row)');
    expect(source).toContain('row.demand_type');
    expect(source).toContain('表面 ¥');
    expect(source).toContain('净有效 ¥');
    expect(source).toContain('/㎡/月');
  });

  it('supports progressive disclosure for research detail without cluttering the default list', () => {
    expect(source).toContain('expandedReadId');
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain('<DetailRow label="代理公司" value={row.agency_company || \'—\'} />');
    expect(source).toContain('<DetailRow label="经纪人" value={row.agency_person || \'—\'} />');
    expect(source).toContain('{row.remarks ? <DetailRow label="备注" value={row.remarks} multiline /> : null}');
  });

  it('keeps exact matches quiet and explains project-level uncertainty only when relevant', () => {
    expect(source).toContain("row.building_match_scope === 'project'");
    expect(source).toContain('项目级关联：成交已确认属于该项目，但历史数据无法精确到当前具体塔楼。');
    expect(source).not.toContain('精确楼宇');
  });

  it('uses a restrained four-level typography rhythm in the panel', () => {
    expect(source).toContain('text-[14px]');
    expect(source).toContain('text-[13px]');
    expect(source).toContain('text-[12px]');
    expect(source).toContain('text-[11px]');
    expect(source).not.toContain('text-[10px]');
  });
});

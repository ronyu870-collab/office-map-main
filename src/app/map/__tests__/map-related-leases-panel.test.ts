import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/app/map/MapLeaseTransactionsBridge.tsx', 'utf8');

describe('map related deals presentation contract', () => {
  it('keeps the compact InfoWindow entry and governed building-id read path', () => {
    expect(source).toContain("const RELATED_ACTION_LABEL = '关联成交';");
    expect(source).toContain("ACTION_MODULES.findIndex(module => module.id === 'latest-sales')");
    expect(source).toContain('button.dataset.mapAction = RELATED_ACTION_ID');
    expect(source).toContain('building_id: buildingId');
    expect(source).toContain('limit: String(PAGE_SIZE)');
    expect(source).toContain('offset: String(page * PAGE_SIZE)');
    expect(source).toContain('const PAGE_SIZE = 50;');
  });

  it('prioritizes broker scanability and removes source noise from the collapsed summary', () => {
    expect(source).toContain('summaryIndustry(row)');
    expect(source).toContain('row.demand_type');
    expect(source).toContain('表面 ¥');
    expect(source).toContain('净有效 ¥');
    expect(source).toContain('/㎡/月');
    expect(source).toContain('const descriptors = [industry, row.demand_type, leaseTerm]');
    expect(source).not.toContain('const descriptors = [\n                summaryIndustry(row),\n                row.demand_type,\n                leaseTermLabel(row.lease_term_months),\n                sourceLabel(row)');
  });

  it('uses deliberate missing-value language instead of raw dash placeholders', () => {
    expect(source).toContain("return row.sub_industry || row.industry || '未标注';");
    expect(source).toContain("value={row.demand_type || '未标注'}");
    expect(source).toContain("value={leaseTerm || '未记录'}");
    expect(source).toContain('<DetailItem label="租金" value="未记录" span={2} subdued />');
    expect(source).not.toContain("|| '—'");
    expect(source).not.toContain("return '—'");
  });

  it('hides empty optional broker and remarks fields while preserving internal detail when present', () => {
    expect(source).toContain('const broker = brokerLabel(row);');
    expect(source).toContain('{broker ? <DetailItem label="经纪信息" value={broker} span={2} /> : null}');
    expect(source).toContain('{row.remarks ? <DetailItem label="备注"');
    expect(source).toContain("return [row.agency_company, row.agency_person].filter(Boolean).join(' · ');");
  });

  it('keeps project-level uncertainty neutral and contextual rather than adding another color system', () => {
    expect(source).toContain('border-[var(--cd-color-border)]/80');
    expect(source).toContain('text-[var(--cd-color-text-secondary)]">项目级</span>');
    expect(source).toContain('项目级关联，历史记录无法精确到具体塔楼');
    expect(source).not.toContain('amber-');
  });

  it('uses restrained typography and neutral text tokens', () => {
    expect(source).toContain('text-[14px]');
    expect(source).toContain('text-[12px]');
    expect(source).toContain('text-[11px]');
    expect(source).not.toContain('text-[10px]');
    expect(source).not.toContain('text-amber-');
  });

  it('adds progressive disclosure motion without reintroducing modal or card clutter', () => {
    expect(source).toContain('expandedReadId');
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain("transition-[grid-template-rows,opacity] duration-200 ease-out");
    expect(source).toContain("grid-rows-[1fr] opacity-100");
    expect(source).toContain("grid-rows-[0fr] opacity-0");
    expect(source).toContain('transition-transform duration-200 ease-out');
  });

  it('uses a minimal centered pagination treatment', () => {
    expect(source).toContain('{page + 1} / {totalPages}');
    expect(source).toContain('justify-center gap-2.5');
    expect(source).not.toContain('第 {page + 1} / {totalPages} 页');
    expect(source).not.toContain('1–50');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/app/lease-submission/history/page.tsx', 'utf8');
const layoutSource = readFileSync('src/app/lease-submission/layout.tsx', 'utf8');

describe('lease history workbench presentation contract', () => {
  it('keeps the database paginated without reintroducing dashboard-style KPI cards', () => {
    expect(source).toContain('const PAGE_SIZE = 50;');
    expect(source).toContain("offset: String(pageIndex * PAGE_SIZE)");
    expect(source).toContain('上一页');
    expect(source).toContain('下一页');
    expect(source).not.toContain('MetricCard');
    expect(source).not.toContain('本页数据来源');
    expect(source).not.toContain('本页楼宇关联');
  });

  it('keeps one compact Chinese-first workspace hierarchy', () => {
    expect(source).toContain('title="成交数据库"');
    expect(source).not.toContain('Lease intelligence');
    expect(source).not.toContain('统一读取层');
    expect(source).toContain('placeholder="公司"');
    expect(source).toContain('placeholder="楼宇"');
    expect(source).toContain('筛选');
    expect(source).toContain('成交记录');
  });

  it('keeps identity semantics available without dedicating noisy table columns to them', () => {
    expect(source).toContain("if (scope === 'exact') return '精确到楼宇';");
    expect(source).toContain("if (scope === 'project') return '项目级';");
    expect(source).toContain("return '未关联';");
    expect(source).toContain('仅确认到项目，未指定具体塔楼');
    expect(source).not.toContain("'来源', '楼宇关联'");
  });

  it('keeps row detail pivots while removing the duplicate floating back action on the database route', () => {
    expect(source).toContain('成交详情');
    expect(source).toContain('查看同名企业成交');
    expect(source).toContain('查看楼宇成交');
    expect(layoutSource).toContain('if (inDatabase) return <>{children}</>;');
    expect(layoutSource).toContain('href="/lease-submission/history"');
  });

  it('shows historical source controls only when the server grants admin history access', () => {
    expect(source).toContain('const [canReadHistory, setCanReadHistory] = React.useState<boolean | null>(null);');
    expect(source).toContain('setCanReadHistory(body?.access?.canReadHistory === true);');
    expect(source).toContain('canReadHistory === true ? (');
    expect(source).toContain("const effectiveSource: SourceFilter = canReadHistory === true ? appliedFilters.source : 'live';");
  });
});

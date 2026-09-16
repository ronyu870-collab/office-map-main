import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/app/lease-submission/history/page.tsx', 'utf8');

describe('lease history workbench presentation contract', () => {
  it('keeps the database as a paginated intelligence workspace rather than a flat first-100 table', () => {
    expect(source).toContain('const PAGE_SIZE = 50;');
    expect(source).toContain("offset: String(pageIndex * PAGE_SIZE)");
    expect(source).toContain('上一页');
    expect(source).toContain('下一页');
    expect(source).not.toContain('当前显示前 100 条');
  });

  it('keeps primary search, layered filters, summary, and row detail interactions visible', () => {
    expect(source).toContain('搜索公司名称');
    expect(source).toContain('搜索楼宇名称');
    expect(source).toContain('高级筛选');
    expect(source).toContain('本页楼宇关联');
    expect(source).toContain('当前条件');
    expect(source).toContain('成交详情');
    expect(source).toContain('查看同公司');
    expect(source).toContain('查看同楼宇');
  });

  it('preserves exact/project/unmapped identity semantics in the UI', () => {
    expect(source).toContain("if (scope === 'exact') return '精确楼宇';");
    expect(source).toContain("if (scope === 'project') return '项目级';");
    expect(source).toContain("return '待映射';");
    expect(source).toContain('不会把历史成交伪精确到当前某一塔楼');
  });
});

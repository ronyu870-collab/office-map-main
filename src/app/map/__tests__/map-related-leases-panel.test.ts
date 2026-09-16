import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/app/map/MapLeaseTransactionsBridge.tsx', 'utf8');

describe('map related deals presentation contract', () => {
  it('uses a compact InfoWindow action instead of rendering lease rows inside the InfoWindow', () => {
    expect(source).toContain("const RELATED_ACTION_LABEL = '关联成交';");
    expect(source).toContain("ACTION_MODULES.findIndex(module => module.id === 'latest-sales')");
    expect(source).toContain("button.dataset.mapAction = RELATED_ACTION_ID");
    expect(source).not.toContain('data-lease-read-panel');
    expect(source).not.toContain('正在读取租赁成交');
  });

  it('opens a dedicated associated-deals panel and preserves governed building-id reads', () => {
    expect(source).toContain('aria-label={`${context.buildingName || \'当前楼宇\'}关联成交`}');
    expect(source).toContain("building_id: buildingId");
    expect(source).toContain('limit: String(PAGE_SIZE)');
    expect(source).toContain('offset: String(page * PAGE_SIZE)');
    expect(source).toContain("const PAGE_SIZE = 50;");
    expect(source).toContain('项目级关联');
    expect(source).toContain('实时成交');
    expect(source).toContain('历史成交');
  });

  it('keeps exact matches quiet and explains project-level uncertainty only when relevant', () => {
    expect(source).toContain("row.building_match_scope === 'project' ? ' · 项目级关联' : ''");
    expect(source).toContain('项目级关联表示成交已确认属于该项目');
    expect(source).not.toContain('精确楼宇');
  });
});

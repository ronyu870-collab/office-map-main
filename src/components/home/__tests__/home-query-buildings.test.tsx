import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeQueryBuildings } from '../HomeQueryBuildings';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { buildListResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';

const client = vi.hoisted(() => ({ buildings: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client, queryScopeKey: (value: unknown) => JSON.stringify(value) }));
const ids = Array.from({ length: 7 }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const requestId = '20000000-0000-4000-8000-000000000001';
const scope = { actorId: ids[0], effectiveId: ids[0], sessionId: requestId, targetId: null };
function result(count = 1) {
  const data = resultViewSchema.parse(buildListResult(fixture(), ['netEffectiveRent']));
  const source = data.sources.find(item => item.id === data.table.rows[0].cells.name.sourceIds[0])!;
  data.sources.push(...ids.slice(0, count).map((id, index) => ({ ...source, id: `name-${id}`, entityId: id, recordId: id, rawValue: `合成楼${index + 1}` })));
  data.table.rows = ids.slice(0, count).map((id, index) => ({ entityId: id, cells: { ...data.table.rows[0].cells,
    name: { kind: 'text', value: `合成楼${index + 1}`, sourceIds: [`name-${id}`] } } }));
  return data;
}
function metadata(data: ReturnType<typeof result>, offset = 0) {
  return { status: 'ready', requestId, resultId: data.resultId, metadataReadAt: '2026-11-16T00:00:00Z', total: data.table.rows.length, offset, hasMore: offset + 5 < data.table.rows.length,
    buildings: data.table.rows.slice(offset, offset + 5).map(row => ({ id: row.entityId, name: row.cells.name.kind === 'text' ? row.cells.name.value : '', submarket: 'CBD', grade: 'A', located: false, unavailableReason: 'missing_coordinates', photo: null })) };
}
beforeEach(() => vi.clearAllMocks());
describe('P2 source-bound building cards', () => {
  it('T03 preserves unknown photos/coordinates and historical metric period; source action keeps same IDs', async () => {
    const data = result(), source = vi.fn(); client.buildings.mockResolvedValue(metadata(data));
    render(<HomeQueryBuildings result={data} requestId={requestId} scope={scope} onSource={source} />);
    const card = await screen.findByRole('article', { name: '合成楼1楼宇卡片' });
    expect(card).toHaveTextContent('2026Q3'); expect(card).toHaveTextContent('100'); expect(card).toHaveTextContent('暂无可访问的实景照片');
    expect(card).toHaveTextContent('不会补造位置'); expect(card.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '100' })); expect(source.mock.calls[0][0]).toEqual(data.table.rows[0].cells.netEffectiveRent.sourceIds);
    expect(screen.queryByRole('link', { name: '查看楼宇详情' })).not.toBeInTheDocument();
    expect(card).toHaveTextContent('现有楼宇详情依赖地图位置');
    expect(screen.getAllByRole('link', { name: '在地图中查看' }).at(-1)).toHaveAttribute('href', expect.stringContaining(ids[0]));
  });
  it('T15 bounds card rendering and loads only selected page metadata; retained rows never requery metrics', async () => {
    const data = result(7); client.buildings.mockImplementation(async (_scope, input) => metadata(data, input.offset));
    render(<HomeQueryBuildings result={data} requestId={requestId} scope={scope} />);
    await screen.findByRole('article', { name: '合成楼1楼宇卡片' }); expect(screen.getAllByRole('article')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '下一组楼宇' })); await screen.findByRole('article', { name: '合成楼6楼宇卡片' });
    expect(screen.getAllByRole('article')).toHaveLength(2); expect(client.buildings).toHaveBeenCalledTimes(2);
    expect(client.buildings.mock.calls[1][1]).toMatchObject({ requestId, resultId: data.resultId, offset: 5, limit: 5 });
  });
  it('T15 never paints a new page with the previous page directory before effects run', async () => {
    const data = result(7), paintedCards: string[] = []; let resolve!: (value: unknown) => void;
    client.buildings.mockResolvedValueOnce(metadata(data)).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<React.Profiler id="building-page" onRender={() => {
      const card = document.querySelector('[aria-label="合成楼6楼宇卡片"]');
      if (card) paintedCards.push(card.textContent ?? '');
    }}><HomeQueryBuildings result={data} requestId={requestId} scope={scope} /></React.Profiler>);
    await screen.findByRole('article', { name: '合成楼1楼宇卡片' });
    fireEvent.click(screen.getByRole('button', { name: '下一组楼宇' }));
    // Profiler observes each DOM commit, including the one before passive effects clear stale metadata.
    expect(paintedCards).toEqual([]);
    expect(screen.queryByRole('article', { name: '合成楼6楼宇卡片' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在核对楼宇访问权限与当前目录');
    await act(async () => resolve(metadata(data, 5)));
    expect(await screen.findByRole('article', { name: '合成楼6楼宇卡片' })).toHaveTextContent('CBD · 甲级');
    expect(paintedCards.length).toBeGreaterThan(0);
    expect(paintedCards.every(text => text.includes('CBD · 甲级') && !text.includes('子市场未知'))).toBe(true);
    expect(client.buildings).toHaveBeenCalledTimes(2);
  });
  it('T12 late responses after identity change never restore old cards', async () => {
    const data = result(); let resolve!: (value: unknown) => void;
    client.buildings.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(metadata(data));
    const view = render(<HomeQueryBuildings result={data} requestId={requestId} scope={scope} />);
    const firstSignal = client.buildings.mock.calls[0][2] as AbortSignal;
    view.rerender(<HomeQueryBuildings result={data} requestId={requestId} scope={{ ...scope, sessionId: ids[1] }} />);
    expect(firstSignal.aborted).toBe(true); resolve({ ...metadata(data), buildings: [] });
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
  });
});

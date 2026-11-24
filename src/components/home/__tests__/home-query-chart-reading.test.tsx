import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeQueryArtifacts } from '../HomeQueryArtifacts';
import { buildDistributionResult } from '@/src/lib/intelligence/query/result';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { resolveNumericFact } from '@/src/lib/intelligence/query/facts';

const client = vi.hoisted(() => ({ chart: vi.fn(), reportDelivery: vi.fn().mockResolvedValue(true) }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('reads the exact histogram interval by keyboard and links it to its original sources', async () => {
  const result = resultViewSchema.parse(buildDistributionResult(fixture(), 'rent'));
  const original = JSON.stringify(result);
  const chart = buildResultChart(result, { kind: 'histogram' });
  const point = chart.points[0];
  client.chart.mockResolvedValue(chart);
  const onSource = vi.fn();
  render(<HomeQueryArtifacts result={result} requestId="request" scope={{ actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null }} internalExport={false} onSource={onSource} />);
  fireEvent.click(screen.getByText('图表设置'));
  fireEvent.click(screen.getByRole('button', { name: '查看直方图' }));
  const plot = await screen.findByRole('img', { name: /直方图/ });
  const bar = within(plot).getByRole('button', { name: `${point.label}：${point.yText} 栋` });
  fireEvent.keyDown(bar, { key: 'Enter' });
  const reading = screen.getByRole('status', { name: '区间读数' });
  expect(reading).toHaveTextContent(`${point.label}：${point.yText} 栋`);
  fireEvent.click(within(reading).getByRole('button', { name: '数据依据' }));
  expect(onSource).toHaveBeenCalledWith(point.yCell.sourceIds, `${point.label}：${point.yText} 栋`, expect.any(HTMLButtonElement));
  expect(screen.getByRole('table', { name: '分箱边界与数量' })).toBeVisible();
  await waitFor(() => expect(client.chart).toHaveBeenCalledOnce());
  expect(JSON.stringify(result)).toBe(original);
});

it('keeps a zero-count interval readable in the table without an invisible SVG tab stop', async () => {
  const originalSnapshot = fixture();
  const values = [100, 101, null, 200];
  const snapshot = { ...originalSnapshot, rows: originalSnapshot.rows.map((row, index) => {
    const rent = row.facts.netEffectiveRent;
    if (!rent) throw new Error('fixture must include rent candidates');
    return { ...row, facts: { ...row.facts, netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id,
      rent.sources.map(source => ({ ...source, rawValue: values[index] })), originalSnapshot.period) } };
  }) };
  const result = resultViewSchema.parse(buildDistributionResult(snapshot, 'rent'));
  const chart = buildResultChart(result, { kind: 'histogram' });
  const zero = chart.points.find(point => point.y === 0);
  if (!zero) throw new Error('fixture must have an empty interval');
  client.chart.mockResolvedValue(chart);
  const onSource = vi.fn();
  render(<HomeQueryArtifacts result={result} requestId="request" scope={{ actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null }} internalExport={false} onSource={onSource} />);
  fireEvent.click(screen.getByText('图表设置'));
  fireEvent.click(screen.getByRole('button', { name: '查看直方图' }));
  const plot = await screen.findByRole('img', { name: /直方图/ });
  expect(within(plot).queryByRole('button', { name: `${zero.label}：0 栋` })).not.toBeInTheDocument();
  const table = screen.getByRole('table', { name: '分箱边界与数量' });
  const row = within(table).getByRole('row', { name: `${zero.label} 0 栋` });
  fireEvent.click(within(row).getByRole('button', { name: '0 栋' }));
  expect(onSource).toHaveBeenCalledWith(zero.yCell.sourceIds, `${zero.label}：0栋`, expect.any(HTMLButtonElement));
});

import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult, buildTrendResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';

vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: { reportDelivery: vi.fn() } }));
import { AssistantHeading } from '../HomeQueryExperience';
import { HomeQueryResult } from '../HomeQueryResult';
import { HomeQueryResearchPanel } from '../HomeQueryResearchPanel';

afterEach(cleanup);

describe('AI answer reading and evidence navigation', () => {
  it('announces the assistant identity once while retaining meaningful answer labels', () => {
    const view = render(<AssistantHeading label="Colliers AI" />);
    expect(screen.getAllByText('Colliers AI')).toHaveLength(1);
    view.rerender(<AssistantHeading label="研究结果" />);
    expect(screen.getByText('Colliers AI')).toBeVisible();
    expect(screen.getByText('研究结果')).toBeVisible();
  });

  it('navigates a long result to its exact details without recalculating or replacing the result', async () => {
    const result = resultViewSchema.parse(buildTrendResult(Array.from({ length: 12 }, (_, index) => {
      const snapshot = fixture({ year: 2024 + Math.floor(index / 4), quarter: index % 4 + 1 });
      return { ...snapshot, rows: snapshot.rows.map(row => ({ ...row, facts: Object.fromEntries(Object.entries(row.facts).map(([field, fact]) => [field,
        { ...fact, sources: fact.sources.map(source => source.period ? { ...source, id: `${source.id}/${snapshot.period!.year}`, recordId: `${source.recordId}/${snapshot.period!.year}` } : source) },
      ])) })) };
    }), 'rent', 'per_period'));
    render(<HomeQueryResult result={result} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/查看数据明细/));
    const table = await screen.findByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' });
    const source = screen.getByRole('button', { name: '数据依据' });
    fireEvent.click(source);
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '关闭来源' }));
    await waitFor(() => expect(source).toHaveFocus());
    expect(screen.getByRole('table')).toBe(table);
  });

  it('keeps short metric answers free of an unnecessary section directory', () => {
    render(<HomeQueryResult result={resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'))} />);
    expect(screen.queryByRole('navigation', { name: '本条回答目录' })).not.toBeInTheDocument();
  });

  it('opens existing evidence from the research companion without creating an original-file link', () => {
    const onViewSources = vi.fn();
    const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
    render(<HomeQueryResearchPanel result={result} onViewSources={onViewSources} />);
    fireEvent.click(screen.getByRole('button', { name: '查看来源明细' }));
    expect(onViewSources).toHaveBeenCalledOnce();
    expect(screen.getByRole('region', { name: '来源概览' })).toHaveTextContent('未参与计算');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useGridFilters } from '../useGridFilters';
import type { TableConfig } from '../../types';

const config: TableConfig = {
  table: 'synthetic', label: '合成', cols: [
    { key: 'id', label: 'ID', type: 'text', hidden: true, readOnly: true },
    { key: 'building_id', label: '楼宇', type: 'text', foreignKey: 'buildings' },
    { key: 'grade', label: '等级', type: 'text', displayMap: { A: '甲级', B: '乙级' }, exactFilter: true },
    { key: 'value', label: '价格', type: 'number' },
  ],
};
const rows = [
  { id: '1', building_id: 'b1', grade: 'A', value: 100 },
  { id: '2', building_id: 'b2', grade: 'B', value: 200 },
];

describe('admin grid active filters', () => {
  it('keeps global keyword, foreign-key label and exact-column matching without calculating unused option catalogs', () => {
    const { result } = renderHook(() => useGridFilters(rows, config, { buildings: { b1: '合成甲楼', b2: '合成乙楼' } }));
    expect(result.current.filtered).toHaveLength(2);
    expect('filterOptions' in result.current).toBe(false);
    act(() => result.current.setSearch('合成乙'));
    expect(result.current.filtered.map(row => row.id)).toEqual(['2']);
    act(() => result.current.setSearch(''));
    act(() => result.current.setColumnFilter('grade', 'A'));
    expect(result.current.filtered.map(row => row.id)).toEqual(['1']);
    act(() => result.current.setColumnFilter('grade', 'B'));
    expect(result.current.filtered.map(row => row.id)).toEqual(['2']);
  });
});

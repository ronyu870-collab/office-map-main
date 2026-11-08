import * as React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const read = vi.hoisted(() => vi.fn());
vi.mock('../readAssignedBuildings', () => ({ readAssignedBuildings: (...args: unknown[]) => read(...args) }));
import { useAssignedBuildings } from './useAssignedBuildings';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => { read.mockReset().mockImplementation(async (ids: string[]) => (ids as string[]).map(id => ({ id, name: id }))); });

describe('quarterly scoped building cache', () => {
  it('waits for assignments then isolates old and new ownership contexts', async () => {
    const hook = renderHook(
      ({ ids, scope }: { ids: string[] | null; scope: string | null }) => useAssignedBuildings(ids, scope),
      { wrapper, initialProps: { ids: null as string[] | null, scope: null as string | null } },
    );
    expect(read).not.toHaveBeenCalled();
    hook.rerender({ ids: ['tower-b', 'tower-a', 'tower-a'], scope: 'owner-a' });
    await waitFor(() => expect(hook.result.current.buildings).toHaveLength(2));
    expect(read).toHaveBeenCalledWith(['tower-a', 'tower-b']);
    hook.rerender({ ids: ['tower-a'], scope: 'owner-b' });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.buildings).toEqual([{ id: 'tower-a', name: 'tower-a' }]));
    hook.unmount();
  });
});

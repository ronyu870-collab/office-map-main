import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useBuildings } from '../useBuildings';
import { getBuildings } from '@/src/services/apiClient';

vi.mock('@/src/services/apiClient', () => ({
  getBuildings: vi.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ 
    provider: () => new Map(),
    // For tests, we want to fetch data on mount to verify the hook works correctly
    // In production, revalidateOnMount defaults to false for performance
    dedupingInterval: 0, // Disable deduping in tests to ensure fresh data
  }}>
    {children}
  </SWRConfig>
);

describe('useBuildings Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该成功加载楼宇数据', async () => {
    const mockData = [
      { id: '1', name: 'Building A', district: 'Chaoyang', grade: 'A', lng: 116.4, lat: 39.9 },
      { id: '2', name: 'Building B', district: 'Haidian', grade: 'B', lng: 116.3, lat: 39.8 },
    ];
    vi.mocked(getBuildings).mockResolvedValue(mockData as any);

    const { result } = renderHook(() => useBuildings({ revalidateOnMount: true }), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.buildings).toBeUndefined();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.buildings).toEqual(mockData);
    expect(result.current.error).toBeUndefined();
  });

  it('应该处理加载错误', async () => {
    const mockError = new Error('Network error');
    vi.mocked(getBuildings).mockRejectedValue(mockError);

    const { result } = renderHook(() => useBuildings({ revalidateOnMount: true }), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.buildings).toBeUndefined();
  });

  it('应该支持按用户筛选', async () => {
    const mockData = [
      { id: '1', name: 'Building A', owner_user: 'John', district: 'Chaoyang', grade: 'A' },
    ];
    vi.mocked(getBuildings).mockResolvedValue(mockData as any);

    const { result } = renderHook(
      () => useBuildings({ ownerUser: 'John', revalidateOnMount: true }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getBuildings).toHaveBeenCalledWith({
      ownerUser: 'John',
      requirePosition: undefined,
    });
    expect(result.current.buildings).toEqual(mockData);
  });

  it('应该支持 requirePosition 参数', async () => {
    const mockData = [
      { id: '1', name: 'Building A', lng: 116.4, lat: 39.9, district: 'Chaoyang', grade: 'A' },
    ];
    vi.mocked(getBuildings).mockResolvedValue(mockData as any);

    const { result } = renderHook(
      () => useBuildings({ requirePosition: true, revalidateOnMount: true }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(getBuildings).toHaveBeenCalledWith({
      ownerUser: undefined,
      requirePosition: true,
    });
    expect(result.current.buildings).toEqual(mockData);
  });

  it('应该提供 mutate 函数用于手动刷新', async () => {
    const mockData = [{ id: '1', name: 'Building A', district: 'Chaoyang', grade: 'A' }];
    vi.mocked(getBuildings).mockResolvedValue(mockData as any);

    const { result } = renderHook(() => useBuildings({ revalidateOnMount: true }), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.mutate).toBeDefined();
    expect(typeof result.current.mutate).toBe('function');
  });

  it('默认情况下不应在挂载时重新验证（性能优化）', async () => {
    const mockData = [{ id: '1', name: 'Building A', district: 'Chaoyang', grade: 'A' }];
    vi.mocked(getBuildings).mockResolvedValue(mockData as any);

    // 不传 revalidateOnMount，应该默认为 false
    const { result } = renderHook(() => useBuildings(), { wrapper });

    // 由于 revalidateOnMount: false，不会立即加载数据
    expect(result.current.isLoading).toBe(false);
    expect(result.current.buildings).toBeUndefined();
    
    // 但可以通过 mutate 手动触发加载
    expect(result.current.mutate).toBeDefined();
  });
});

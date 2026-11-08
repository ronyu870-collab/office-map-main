import useSWR from 'swr';
import { getBuildings } from '@/src/services/apiClient';
import type { BuildingRow } from '@/src/services/apiClient';

interface UseBuildingsOptions {
  ownerUser?: string;
  requirePosition?: boolean;
  revalidateOnMount?: boolean;
}

interface UseBuildingsReturn {
  buildings: BuildingRow[] | undefined;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => void;
}

/**
 * 自定义 Hook：获取楼宇数据
 * 
 * 使用 SWR 配合 Supabase 直连获取楼宇数据，提供自动缓存和状态管理。
 * 
 * 优化配置（Task 3.4）：
 * - revalidateOnMount: false（默认）- 使用缓存数据，避免不必要的重新验证
 * - dedupingInterval: 10s - 增加去重间隔，减少重复请求
 * - revalidateOnFocus: false - 避免标签页切换时重新验证
 * 
 * @param options - 配置选项
 * @param options.ownerUser - 仅获取指定负责人的楼宇（用于 Update 页面）
 * @param options.requirePosition - 仅获取有经纬度的楼宇（用于地图页面）
 * @param options.revalidateOnMount - 组件挂载时是否重新验证数据（默认 false，使用缓存）
 * 
 * @returns 包含 buildings 数据、loading 状态、错误信息和 mutate 函数的对象
 * 
 * @example
 * // 获取所有楼宇（使用缓存）
 * const { buildings, isLoading, error } = useBuildings();
 * 
 * @example
 * // 获取指定用户负责的楼宇
 * const { buildings } = useBuildings({ ownerUser: 'John Doe' });
 * 
 * @example
 * // 获取有经纬度的楼宇（用于地图）
 * const { buildings } = useBuildings({ requirePosition: true });
 * 
 * @example
 * // 强制重新验证（管理后台等需要最新数据的场景）
 * const { buildings } = useBuildings({ revalidateOnMount: true });
 * 
 * **Validates: Requirements 2.2, 2.5, 2.6**
 */
export function useBuildings(options?: UseBuildingsOptions): UseBuildingsReturn {
  // 构建缓存键：根据参数生成唯一的缓存标识
  const requirePosition = options?.requirePosition ?? false;
  const cacheKey = options?.ownerUser 
    ? ['buildings', options.ownerUser, requirePosition]
    : ['buildings', 'all', requirePosition];

  console.log('🚨 [useBuildings] Hook 初始化');
  console.log('   - cacheKey:', cacheKey);
  console.log('   - revalidateOnMount:', options?.revalidateOnMount ?? false);

  const { data, error, isLoading, mutate } = useSWR(
    cacheKey,
    async () => {
      console.log('🚨 [useBuildings] SWR fetcher 开始执行');
      console.log('   - 调用 getBuildings，参数:', { ownerUser: options?.ownerUser, requirePosition: options?.requirePosition });
      
      const result = await getBuildings({
        ownerUser: options?.ownerUser,
        requirePosition: options?.requirePosition,
      });
      
      console.log('🚨 [useBuildings] SWR fetcher 执行完成');
      console.log('   - 返回数据:', result ? `${result.length} 条记录` : 'null/undefined');
      if (result && result.length > 0) {
        console.log('   - 第一条记录:', result[0].id, result[0].name);
      }
      
      return result;
    },
    {
      // ✅ 性能优化：默认使用缓存，避免每次挂载都重新验证
      // 仅在明确需要最新数据时才设置 revalidateOnMount: true
      revalidateOnMount: options?.revalidateOnMount ?? false,
      dedupingInterval: 10000, // Increased from 5s to 10s to reduce unnecessary requests
      revalidateOnFocus: false, // Avoid tab switch revalidation
    }
  );

  console.log('🚨 [useBuildings] Hook 返回状态');
  console.log('   - data:', data ? `${data.length} 条` : 'undefined');
  console.log('   - isLoading:', isLoading);
  console.log('   - error:', error ? error.message : 'null');

  return {
    buildings: data,
    isLoading,
    error,
    mutate,
  };
}

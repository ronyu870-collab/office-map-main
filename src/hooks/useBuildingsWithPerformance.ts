import { useEffect, useRef } from 'react';
import { useBuildings } from './useBuildings';
import type { BuildingRow } from '@/src/services/apiClient';
import { 
  startPerformanceMeasure, 
  endPerformanceMeasure, 
  logSWRCache 
} from '@/src/utils/performanceMonitor';

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
 * 带性能监控的 useBuildings Hook
 * 
 * 在开发环境下自动记录数据获取性能指标和 SWR 缓存状态
 * 
 * @param options - 配置选项
 * @param measureKey - 性能测量标识符（默认为 'buildings-fetch'）
 * 
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 */
export function useBuildingsWithPerformance(
  options?: UseBuildingsOptions,
  measureKey: string = 'buildings-fetch'
): UseBuildingsReturn {
  const { buildings, isLoading, error, mutate } = useBuildings(options);
  
  const isFirstLoad = useRef(true);
  const previousLoadingState = useRef(isLoading);
  const measureStarted = useRef(false);
  
  useEffect(() => {
    // 开始加载时启动性能测量
    if (isLoading && !measureStarted.current) {
      startPerformanceMeasure(measureKey);
      measureStarted.current = true;
      
      // 记录缓存状态
      if (isFirstLoad.current) {
        logSWRCache(
          options?.ownerUser ? ['buildings', options.ownerUser] : 'buildings',
          'MISS',
          { reason: '首次加载' }
        );
      } else {
        logSWRCache(
          options?.ownerUser ? ['buildings', options.ownerUser] : 'buildings',
          'UPDATE',
          { reason: '后台更新' }
        );
      }
    }
    
    // 加载完成时结束性能测量
    if (previousLoadingState.current && !isLoading && measureStarted.current) {
      const isCacheHit = !isFirstLoad.current;
      const dataSize = buildings?.length;
      
      endPerformanceMeasure(measureKey, isCacheHit, dataSize);
      measureStarted.current = false;
      
      // 记录缓存命中
      if (isCacheHit) {
        logSWRCache(
          options?.ownerUser ? ['buildings', options.ownerUser] : 'buildings',
          'HIT',
          { dataSize }
        );
      }
      
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
      }
    }
    
    previousLoadingState.current = isLoading;
  }, [isLoading, buildings, measureKey, options?.ownerUser]);
  
  // 包装 mutate 函数以记录手动刷新
  const wrappedMutate = () => {
    if (process.env.NODE_ENV === 'development') {
      logSWRCache(
        options?.ownerUser ? ['buildings', options.ownerUser] : 'buildings',
        'MUTATE',
        { reason: '手动刷新' }
      );
    }
    mutate();
  };
  
  return {
    buildings,
    isLoading,
    error,
    mutate: wrappedMutate,
  };
}

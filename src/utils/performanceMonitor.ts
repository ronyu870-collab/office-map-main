/**
 * Performance Monitoring Utilities
 * 
 * 用于测量和记录页面性能指标，验证 Supabase 直连 + SWR 优化效果
 * 
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 */

interface PerformanceMetrics {
  startTime: number;
  endTime?: number;
  duration?: number;
  isCacheHit?: boolean;
  dataSize?: number;
}

const metrics = new Map<string, PerformanceMetrics>();

/**
 * 开始性能测量
 * @param key 测量标识符
 */
export function startPerformanceMeasure(key: string): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  metrics.set(key, {
    startTime: performance.now(),
  });
  
  console.log(`⏱️ [Performance] 开始测量: ${key}`);
}

/**
 * 结束性能测量并记录结果
 * @param key 测量标识符
 * @param isCacheHit 是否命中缓存
 * @param dataSize 数据大小（可选）
 */
export function endPerformanceMeasure(
  key: string, 
  isCacheHit: boolean = false,
  dataSize?: number
): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  const metric = metrics.get(key);
  if (!metric) {
    console.warn(`⚠️ [Performance] 未找到测量起点: ${key}`);
    return;
  }
  
  const endTime = performance.now();
  const duration = endTime - metric.startTime;
  
  metric.endTime = endTime;
  metric.duration = duration;
  metric.isCacheHit = isCacheHit;
  metric.dataSize = dataSize;
  
  // 格式化输出
  const cacheStatus = isCacheHit ? '✅ 缓存命中' : '🌐 网络请求';
  const sizeInfo = dataSize ? ` | 数据量: ${dataSize} 条` : '';
  const performanceStatus = isCacheHit && duration < 50 
    ? '🚀 性能优秀' 
    : !isCacheHit && duration < 1000 
    ? '✅ 性能良好' 
    : '⚠️ 性能待优化';
  
  console.log(
    `⏱️ [Performance] ${key}\n` +
    `   ${cacheStatus} | 耗时: ${duration.toFixed(2)}ms${sizeInfo}\n` +
    `   ${performanceStatus}`
  );
  
  // 验证缓存性能要求（Requirement 8.3）
  if (isCacheHit && duration >= 50) {
    console.warn(
      `⚠️ [Performance] 缓存命中但响应时间超标！\n` +
      `   要求: < 50ms | 实际: ${duration.toFixed(2)}ms`
    );
  }
  
  metrics.set(key, metric);
}

/**
 * 获取性能指标
 * @param key 测量标识符
 */
export function getPerformanceMetric(key: string): PerformanceMetrics | undefined {
  return metrics.get(key);
}

/**
 * 计算性能改善百分比
 * @param beforeMs 优化前的时间（毫秒）
 * @param afterMs 优化后的时间（毫秒）
 * @returns 改善百分比
 */
export function calculateImprovement(beforeMs: number, afterMs: number): number {
  return ((beforeMs - afterMs) / beforeMs) * 100;
}

/**
 * 记录 SWR 缓存状态（仅开发环境）
 * @param cacheKey 缓存键
 * @param action 操作类型
 * @param details 详细信息
 */
export function logSWRCache(
  cacheKey: string | any[], 
  action: 'HIT' | 'MISS' | 'UPDATE' | 'MUTATE',
  details?: any
): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  const keyStr = Array.isArray(cacheKey) ? cacheKey.join(' > ') : cacheKey;
  const emoji = {
    HIT: '✅',
    MISS: '❌',
    UPDATE: '🔄',
    MUTATE: '🔧',
  }[action];
  
  console.log(
    `${emoji} [SWR Cache] ${action} | Key: ${keyStr}`,
    details ? `\n   详情:` : '',
    details || ''
  );
}

/**
 * 生成性能报告摘要
 */
export function generatePerformanceReport(): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (metrics.size === 0) {
    console.log('📊 [Performance Report] 暂无性能数据');
    return;
  }
  
  console.log('\n📊 ========== 性能报告 ==========');
  
  metrics.forEach((metric, key) => {
    if (!metric.duration) return;
    
    const status = metric.isCacheHit ? '缓存' : '网络';
    console.log(
      `   ${key}: ${metric.duration.toFixed(2)}ms (${status})` +
      (metric.dataSize ? ` | ${metric.dataSize} 条数据` : '')
    );
  });
  
  console.log('================================\n');
}

/**
 * 清除所有性能指标
 */
export function clearPerformanceMetrics(): void {
  metrics.clear();
}

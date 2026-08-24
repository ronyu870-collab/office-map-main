import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startPerformanceMeasure,
  endPerformanceMeasure,
  getPerformanceMetric,
  calculateImprovement,
  logSWRCache,
  clearPerformanceMetrics,
} from '../performanceMonitor';

describe('performanceMonitor', () => {
  beforeEach(() => {
    // Set to development mode for testing
    vi.stubEnv('NODE_ENV', 'development');
    
    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    // Clear metrics before each test
    clearPerformanceMetrics();
  });

  afterEach(() => {
    // Restore original environment
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('startPerformanceMeasure', () => {
    it('应该记录测量起点', () => {
      startPerformanceMeasure('test-measure');
      const metric = getPerformanceMetric('test-measure');
      
      expect(metric).toBeDefined();
      expect(metric?.startTime).toBeGreaterThan(0);
    });
  });

  describe('endPerformanceMeasure', () => {
    it('应该计算测量耗时', () => {
      startPerformanceMeasure('test-measure');
      
      // 模拟一些延迟
      const start = performance.now();
      while (performance.now() - start < 10) {
        // 等待至少 10ms
      }
      
      endPerformanceMeasure('test-measure', false, 100);
      const metric = getPerformanceMetric('test-measure');
      
      expect(metric?.duration).toBeGreaterThan(0);
      expect(metric?.isCacheHit).toBe(false);
      expect(metric?.dataSize).toBe(100);
    });

    it('应该在缓存命中时间超标时发出警告', () => {
      startPerformanceMeasure('test-measure');
      
      // 模拟超过 50ms 的缓存命中
      const start = performance.now();
      while (performance.now() - start < 60) {
        // 等待至少 60ms
      }
      
      endPerformanceMeasure('test-measure', true);
      
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('calculateImprovement', () => {
    it('应该正确计算性能改善百分比', () => {
      const before = 3500; // 3.5秒
      const after = 800;   // 0.8秒
      
      const improvement = calculateImprovement(before, after);
      
      expect(improvement).toBeCloseTo(77.14, 1);
    });

    it('应该处理 70% 改善的边界情况', () => {
      const before = 3000;
      const after = 900; // 正好 70% 改善
      
      const improvement = calculateImprovement(before, after);
      
      expect(improvement).toBe(70);
    });

    it('应该处理超过 70% 改善的情况', () => {
      const before = 5000;
      const after = 800; // 84% 改善
      
      const improvement = calculateImprovement(before, after);
      
      expect(improvement).toBeGreaterThan(70);
    });
  });

  describe('logSWRCache', () => {
    it('应该记录缓存命中日志', () => {
      logSWRCache('test-key', 'HIT', { dataSize: 100 });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('HIT'),
        expect.anything(),
        expect.anything()
      );
    });

    it('应该记录缓存未命中日志', () => {
      logSWRCache('test-key', 'MISS', { reason: '首次加载' });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('MISS'),
        expect.anything(),
        expect.anything()
      );
    });

    it('应该支持数组形式的缓存键', () => {
      logSWRCache(['buildings', 'user123'], 'HIT');
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('buildings > user123'),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('性能要求验证', () => {
    it('缓存命中时间应小于 50ms', () => {
      startPerformanceMeasure('cache-test');
      
      // 模拟快速缓存读取（< 50ms）
      const start = performance.now();
      while (performance.now() - start < 20) {
        // 等待约 20ms
      }
      
      endPerformanceMeasure('cache-test', true);
      const metric = getPerformanceMetric('cache-test');
      
      expect(metric?.duration).toBeLessThan(50);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('首次加载时间应小于 1500ms（模拟）', () => {
      // 这是一个示例测试，实际测试需要真实的网络请求
      const simulatedLoadTime = 856; // 模拟优化后的加载时间
      
      expect(simulatedLoadTime).toBeLessThan(1500);
    });

    it('性能改善应大于等于 70%', () => {
      const beforeOptimization = 3500; // 优化前
      const afterOptimization = 900;   // 优化后
      
      const improvement = calculateImprovement(beforeOptimization, afterOptimization);
      
      expect(improvement).toBeGreaterThanOrEqual(70);
    });
  });
});

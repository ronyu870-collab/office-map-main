/**
 * 性能日志工具
 * 
 * 用于追踪页面加载和组件渲染的性能瓶颈
 */

type PerformanceEntry = {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
};

class PerformanceLogger {
  private entries: Map<string, PerformanceEntry> = new Map();
  private enabled: boolean;

  constructor() {
    // 仅在开发环境或有 debug 参数时启用
    this.enabled = 
      process.env.NODE_ENV === 'development' || 
      (typeof window !== 'undefined' && window.location.search.includes('debug=perf'));
  }

  /**
   * 开始计时
   */
  start(name: string): void {
    if (!this.enabled) return;
    
    this.entries.set(name, {
      name,
      startTime: performance.now(),
    });
    
    console.log(`⏱️ [Performance] ${name} - 开始`);
  }

  /**
   * 结束计时
   */
  end(name: string): void {
    if (!this.enabled) return;
    
    const entry = this.entries.get(name);
    if (!entry) {
      console.warn(`⚠️ [Performance] ${name} - 未找到开始时间`);
      return;
    }

    const endTime = performance.now();
    const duration = endTime - entry.startTime;
    
    entry.endTime = endTime;
    entry.duration = duration;

    const emoji = duration < 100 ? '✅' : duration < 500 ? '⚠️' : '❌';
    console.log(`${emoji} [Performance] ${name} - 完成 (${duration.toFixed(2)}ms)`);
  }

  /**
   * 记录一个时间点
   */
  mark(name: string): void {
    if (!this.enabled) return;
    
    const time = performance.now();
    console.log(`📍 [Performance] ${name} - ${time.toFixed(2)}ms`);
  }

  /**
   * 获取所有性能数据
   */
  getAll(): PerformanceEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * 生成性能报告
   */
  report(): void {
    if (!this.enabled) return;

    console.group('📊 性能报告');
    
    const entries = this.getAll().filter(e => e.duration !== undefined);
    entries.sort((a, b) => (b.duration || 0) - (a.duration || 0));

    entries.forEach(entry => {
      const emoji = (entry.duration || 0) < 100 ? '✅' : (entry.duration || 0) < 500 ? '⚠️' : '❌';
      console.log(`${emoji} ${entry.name}: ${entry.duration?.toFixed(2)}ms`);
    });

    const total = entries.reduce((sum, e) => sum + (e.duration || 0), 0);
    console.log(`\n⏱️ 总耗时: ${total.toFixed(2)}ms`);
    
    console.groupEnd();
  }

  /**
   * 清除所有数据
   */
  clear(): void {
    this.entries.clear();
  }
}

// 导出单例
export const perfLogger = new PerformanceLogger();

// 便捷函数
export const perfStart = (name: string) => perfLogger.start(name);
export const perfEnd = (name: string) => perfLogger.end(name);
export const perfMark = (name: string) => perfLogger.mark(name);
export const perfReport = () => perfLogger.report();

import { useState, useEffect } from 'react';
import { getSystemTasks } from '@/src/services/adminApi';
import type { SystemTask } from '@/src/types/admin-memo';

/**
 * 系统集成 Hook
 * 
 * 获取系统状态和任务提示
 * 
 * @returns 系统任务列表
 */
export function useSystemIntegration() {
  const [systemTasks, setSystemTasks] = useState<SystemTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSystemStatus() {
      try {
        setLoading(true);
        const tasks = await getSystemTasks();
        setSystemTasks(tasks);
      } catch (err) {
        console.error('Failed to fetch system tasks:', err);
        setSystemTasks([]);
      } finally {
        setLoading(false);
      }
    }

    // 初始加载
    fetchSystemStatus();

    // 每 5 分钟自动刷新
    const interval = setInterval(fetchSystemStatus, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return { systemTasks, loading };
}

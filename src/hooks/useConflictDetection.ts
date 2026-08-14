import { useCallback } from 'react';
import { getAdminMemo } from '@/src/services/adminApi';
import type { ConflictData } from '@/src/types/admin-memo';

interface UseConflictDetectionOptions {
  initialTimestamp: string | null;
  onConflict: (conflictData: ConflictData) => void;
}

interface UseConflictDetectionReturn {
  checkConflict: () => Promise<boolean>;
}

/**
 * 冲突检测 Hook
 * 
 * 检测多管理员同时编辑的情况
 * 
 * @param options - 配置选项
 * @returns 冲突检测方法
 */
export function useConflictDetection({
  initialTimestamp,
  onConflict,
}: UseConflictDetectionOptions): UseConflictDetectionReturn {
  const checkConflict = useCallback(async (): Promise<boolean> => {
    if (!initialTimestamp) return false;

    try {
      const latest = await getAdminMemo();

      // 比较时间戳（转为 Date 对象避免格式差异导致误判）
      const latestTime = new Date(latest.updated_at).getTime();
      const initialTime = new Date(initialTimestamp).getTime();
      if (latestTime !== initialTime) {
        // 检测到冲突
        onConflict({
          serverUpdatedAt: latest.updated_at,
          serverUpdatedBy: latest.updated_by,
          localContent: '', // 将由调用者填充
        });
        return true;
      }

      return false;
    } catch (err) {
      console.error('Conflict detection failed:', err);
      return false;
    }
  }, [initialTimestamp, onConflict]);

  return { checkConflict };
}

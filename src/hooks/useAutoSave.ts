import { useState, useEffect, useRef, useCallback } from 'react';
import debounce from 'lodash.debounce';

interface UseAutoSaveOptions {
  content: string;
  onSave: (content: string) => Promise<void>;
  delay?: number;
  enabled?: boolean;
}

interface UseAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  error: Error | null;
  forceSave: () => Promise<void>;
}

/**
 * 自动保存 Hook
 *
 * 使用 ref 持有最新的 onSave，避免 debounce 函数因依赖变化而频繁重建。
 */
export function useAutoSave({
  content,
  onSave,
  delay = 3000,
  enabled = true,
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // 用 ref 持有最新的 onSave，避免 debounce 因 onSave 引用变化而重建
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // debounce 函数只创建一次，通过 ref 调用最新的 onSave
  const debouncedSaveRef = useRef(
    debounce(async (value: string) => {
      setIsSaving(true);
      setError(null);
      try {
        await onSaveRef.current(value);
        setLastSaved(new Date());
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsSaving(false);
      }
    }, delay)
  );

  // 当内容变化时触发 debounced 保存
  useEffect(() => {
    if (enabled) {
      debouncedSaveRef.current(content);
    }
    return () => {
      debouncedSaveRef.current.cancel();
    };
  }, [content, enabled]);

  // 组件卸载时取消待处理的 debounce
  useEffect(() => {
    const debouncedFn = debouncedSaveRef.current;
    return () => {
      debouncedFn.cancel();
    };
  }, []);

  // 强制立即保存
  const forceSave = useCallback(async () => {
    debouncedSaveRef.current.cancel();
    setIsSaving(true);
    setError(null);
    try {
      await onSaveRef.current(content);
      setLastSaved(new Date());
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsSaving(false);
    }
  }, [content]);

  return { isSaving, lastSaved, error, forceSave };
}

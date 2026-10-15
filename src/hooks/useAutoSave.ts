import { useState, useEffect, useRef, useCallback } from 'react';

type SaveContent = (content: string) => Promise<void>;

interface UseAutoSaveOptions {
  content: string;
  onSave: SaveContent;
  delay?: number;
  enabled?: boolean;
  /** A server-loaded baseline; omit to retain save-on-enable behavior. */
  savedContent?: string;
}

/** Debounce edits, serialize writes, and let navigation await the latest draft. */
export function useAutoSave({ content, onSave, delay = 3000, enabled = true, savedContent }: UseAutoSaveOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [persistedContent, setPersistedContent] = useState(savedContent);
  const latest = useRef({ content, onSave });
  const persisted = useRef(savedContent);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const mounted = useRef(true);

  useEffect(() => { latest.current = { content, onSave }; }, [content, onSave]);
  useEffect(() => {
    if (savedContent !== undefined) {
      persisted.current = savedContent;
      setPersistedContent(savedContent);
      setError(null);
    }
  }, [savedContent]);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A manual version save uses the same queue so an older autosave cannot
  // finish after it and overwrite the new version's current content.
  const forceSave = useCallback((saveVersion?: SaveContent): Promise<boolean> => {
    cancelTimer();
    const task = queue.current.then(async () => {
      if (!mounted.current) return false;
      let save = saveVersion;
      if (!save && persisted.current === latest.current.content) return true;
      setIsSaving(true);
      setError(null);
      try {
        do {
          const snapshot = latest.current.content;
          await (save ?? latest.current.onSave)(snapshot);
          persisted.current = snapshot;
          if (!mounted.current) return false;
          setPersistedContent(snapshot);
          setLastSaved(new Date());
          save = undefined;
          // Include edits made while a slow request was in flight.
        } while (persisted.current !== latest.current.content);
        return true;
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err : new Error('保存失败'));
        return false;
      } finally {
        if (mounted.current) setIsSaving(false);
      }
    });
    queue.current = task;
    return task;
  }, [cancelTimer]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelTimer(); };
  }, [cancelTimer]);

  useEffect(() => {
    if (enabled && content !== persisted.current) {
      timer.current = setTimeout(() => { void forceSave(); }, delay);
    }
    return cancelTimer;
  }, [content, enabled, delay, forceSave, cancelTimer]);

  return { isSaving, lastSaved, error, forceSave, hasUnsavedChanges: content !== persistedContent };
}

import { useEffect, useRef } from 'react';

interface UseKeyboardShortcutsOptions {
  onSave: () => void;
  onToggleEdit: () => void;
  onTogglePreview: () => void;
  enabled?: boolean;
}

/**
 * 键盘快捷键 Hook
 *
 * 支持以下快捷键：
 * - Ctrl+S / Cmd+S: 保存
 * - Ctrl+E / Cmd+E: 切换到编辑模式
 * - Ctrl+P / Cmd+P: 切换到预览模式
 *
 * 使用 ref 持有回调，避免 effect 因回调引用变化而频繁重注册。
 */
export function useKeyboardShortcuts({
  onSave,
  onToggleEdit,
  onTogglePreview,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  const onSaveRef = useRef(onSave);
  const onToggleEditRef = useRef(onToggleEdit);
  const onTogglePreviewRef = useRef(onTogglePreview);

  // 保持 ref 最新
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onToggleEditRef.current = onToggleEdit; }, [onToggleEdit]);
  useEffect(() => { onTogglePreviewRef.current = onTogglePreview; }, [onTogglePreview]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifierKey = isMac ? e.metaKey : e.ctrlKey;
      if (!modifierKey) return;

      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          onSaveRef.current();
          break;
        case 'e':
          e.preventDefault();
          onToggleEditRef.current();
          break;
        case 'p':
          e.preventDefault();
          onTogglePreviewRef.current();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]); // 只在 enabled 变化时重注册
}

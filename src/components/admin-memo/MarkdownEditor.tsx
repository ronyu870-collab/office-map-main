'use client';

import dynamic from 'next/dynamic';
import '@uiw/react-md-editor/markdown-editor.css';

// 动态导入避免 SSR 问题
const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function MarkdownEditor({ value, onChange, disabled = false }: MarkdownEditorProps) {
  return (
    <div
      className="flex h-full flex-col"
      data-color-mode="light"
      style={{ opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
    >
      <MDEditor
        value={value}
        onChange={(val) => onChange(val ?? '')}
        preview="edit"
        height="100%"
        visibleDragbar={false}
        enableScroll
        hideToolbar={false}
        textareaProps={{
          placeholder: '在此输入 Markdown 内容...',
          disabled,
        }}
        style={{ flex: 1 }}
      />
    </div>
  );
}

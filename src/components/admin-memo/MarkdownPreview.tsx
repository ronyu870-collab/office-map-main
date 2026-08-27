'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import Link from 'next/link';
import type { SystemTask } from '@/src/types/admin-memo';
import { SystemTaskList } from './SystemTaskList';

interface MarkdownPreviewProps {
  content: string;
  onTaskToggle?: (lineIndex: number, checked: boolean) => void;
  systemTasks?: SystemTask[];
}

export function MarkdownPreview({
  content,
  onTaskToggle,
  systemTasks = [],
}: MarkdownPreviewProps) {
  // 找到任务列表项在原始 Markdown 中的行号
  // currentChecked: 复选框当前（点击前）的状态
  function findTaskLineIndex(taskText: string, currentChecked: boolean): number {
    const lines = content.split('\n');
    // 搜索当前状态的行（点击前的状态）
    const patterns = currentChecked
      ? [`- [x] ${taskText}`, `- [X] ${taskText}`, `* [x] ${taskText}`, `* [X] ${taskText}`]
      : [`- [ ] ${taskText}`, `* [ ] ${taskText}`];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (patterns.some((p) => line === p)) {
        return i;
      }
    }
    return -1;
  }

  return (
    <div className="h-full overflow-auto">
      {/* 系统集成任务提示 */}
      {systemTasks.length > 0 && (
        <div className="mb-4">
          <SystemTaskList tasks={systemTasks} />
        </div>
      )}

      {/* Markdown 渲染区域 */}
      <div className="memo-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            // 自定义任务列表复选框（可交互）
            input: ({ type, checked, ...props }) => {
              if (type === 'checkbox') {
                // 从父级 li 中提取文本内容
                return (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const li = (e.target as HTMLElement).closest('li');
                      const text = li?.textContent?.trim() ?? '';
                      // e.target.checked 是点击后的新状态，所以当前（点击前）状态是 !e.target.checked
                      const currentChecked = !e.target.checked;
                      const lineIdx = findTaskLineIndex(text, currentChecked);
                      if (lineIdx >= 0 && onTaskToggle) {
                        onTaskToggle(lineIdx, e.target.checked);
                      }
                    }}
                    className="mr-2 h-4 w-4 cursor-pointer rounded border-[var(--cd-color-border-strong)] accent-[var(--cd-color-brand)]"
                    {...props}
                  />
                );
              }
              return <input type={type} checked={checked} {...props} />;
            },

            // 自定义链接渲染（内部链接使用 Next.js Link）
            a: ({ href, children, ...props }) => {
              if (href?.startsWith('/')) {
                return (
                  <Link
                    href={href}
                    className="inline-flex items-center gap-1 font-medium text-[var(--cd-color-brand)] underline-offset-2 hover:underline"
                  >
                    <span>🔗</span>
                    {children}
                  </Link>
                );
              }
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--cd-color-brand)] underline-offset-2 hover:underline"
                  {...props}
                >
                  {children}
                </a>
              );
            },

            // 自定义标题样式（区分不同模板区块）
            h2: ({ children, ...props }) => (
              <h2
                className="mt-6 flex items-center gap-2 border-b border-[var(--cd-color-border)] pb-2 text-[var(--cd-font-size-lg)] font-semibold text-[var(--cd-color-text-primary)] first:mt-0"
                {...props}
              >
                {children}
              </h2>
            ),

            // 自定义代码块
            pre: ({ children, ...props }) => (
              <pre
                className="overflow-x-auto rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-text-primary)] p-4 text-[var(--cd-font-size-md)] text-[var(--cd-color-surface)]"
                {...props}
              >
                {children}
              </pre>
            ),
          }}
        >
          {content || '*暂无内容，点击"编辑"开始编写...*'}
        </ReactMarkdown>
      </div>
    </div>
  );
}

import Link from 'next/link';
import type { SystemTask } from '@/src/types/admin-memo';

interface SystemTaskListProps {
  tasks: SystemTask[];
}

const priorityConfig = {
  high: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    badge: 'bg-red-100 text-red-700',
    icon: '🔴',
    label: '紧急',
  },
  medium: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    badge: 'bg-amber-100 text-amber-700',
    icon: '🟡',
    label: '注意',
  },
  low: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    badge: 'bg-blue-100 text-blue-700',
    icon: '🔵',
    label: '提示',
  },
};

export function SystemTaskList({ tasks }: SystemTaskListProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
        <span>⚡</span>
        <span>系统提示</span>
      </div>
      {tasks.map((task) => {
        const config = priorityConfig[task.priority];
        const content = (
          <div
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${config.bg} ${config.border}`}
          >
            <span className="mt-0.5 text-base">{config.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${config.text}`}>{task.title}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${config.badge}`}>
                  {config.label}
                </span>
              </div>
              {task.description && (
                <p className={`mt-0.5 text-xs ${config.text} opacity-80`}>{task.description}</p>
              )}
            </div>
            {task.link && (
              <span className={`shrink-0 text-xs ${config.text} opacity-70`}>→</span>
            )}
          </div>
        );

        if (task.link) {
          return (
            <Link key={task.id} href={task.link} className="block transition-opacity hover:opacity-80">
              {content}
            </Link>
          );
        }

        return <div key={task.id}>{content}</div>;
      })}
    </div>
  );
}

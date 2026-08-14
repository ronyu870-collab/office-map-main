'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * 补充细节折叠面板
 * 
 * 设计原则：
 * - 默认收起，减少首屏认知负担
 * - 展开/收起动画流畅
 * - 视觉克制，不抢夺核心区注意力
 */

interface AdvancedSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export function AdvancedSection({
  title,
  description,
  children,
  defaultExpanded = false,
}: AdvancedSectionProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  return (
    <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
      {/* 折叠头部 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-zinc-50"
      >
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
          {description && (
            <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
          )}
        </div>
        <div className="ml-4 text-zinc-400">
          {isExpanded ? (
            <ChevronUp size={18} />
          ) : (
            <ChevronDown size={18} />
          )}
        </div>
      </button>

      {/* 折叠内容 */}
      {isExpanded && (
        <div className="border-t border-zinc-200 px-5 py-4 bg-zinc-50/30">
          {children}
        </div>
      )}
    </div>
  );
}

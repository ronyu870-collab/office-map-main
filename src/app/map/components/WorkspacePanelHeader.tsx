'use client';
import * as React from 'react';
import { ArrowLeft, ChevronDown, Maximize2, Minimize2, X } from 'lucide-react';
import type { SheetMode } from '../workspace/workspaceState';

export const WorkspacePanelContext = React.createContext<{
  compact: boolean; mode: SheetMode; setMode: (mode: SheetMode) => void; restore?: () => void;
  backLabel?: string | null; onBack?: () => void;
} | null>(null);

/** Shared navigation belongs in the content title group, never in another toolbar above it. */
export function WorkspacePanelHeader({ title, subtitle, onClose, closeLabel, actions, titleId, titleRef }: {
  title: React.ReactNode; subtitle?: React.ReactNode; onClose: () => void; closeLabel: string;
  actions?: React.ReactNode; titleId?: string; titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  const context = React.useContext(WorkspacePanelContext);
  const [expandedTitle, setExpandedTitle] = React.useState<string | null>(null);
  const longTitle = typeof title === 'string' && title.length > 36;
  const titleExpanded = longTitle && expandedTitle === title;
  const inlineSubtitle = context?.compact && typeof title === 'string' && title.length <= 12 && typeof subtitle === 'string' && subtitle.length <= 12;
  const restore = () => context?.restore ? context.restore() : context?.setMode('compact');
  const fullscreen = context?.mode === 'full';
  return <header className="workspace-panel-header">
    <div className="workspace-panel-title-row">
      {context?.backLabel ? <button type="button" className="workspace-icon" onClick={context.onBack}
        aria-label={`返回${context.backLabel}`} title={`返回${context.backLabel}`}><ArrowLeft size={17} aria-hidden="true" /></button> : null}
      <h2 id={titleId} ref={titleRef} title={typeof title === 'string' ? title : undefined} tabIndex={titleRef ? -1 : undefined}>
        {longTitle ? <button type="button" className="workspace-title-toggle" aria-expanded={titleExpanded}
          title={titleExpanded ? '收起完整名称' : '展开完整名称'} onClick={() => setExpandedTitle(titleExpanded ? null : title)}>
          <span className={titleExpanded ? 'workspace-title-expanded' : 'workspace-title-clamped'}>{title}</span><ChevronDown size={14} aria-hidden="true" />
        </button> : inlineSubtitle ? <span className="workspace-heading-inline"><span>{title}</span><span className="workspace-heading-meta">{subtitle}</span></span> : title}
      </h2>
      {context?.compact ? <div className="workspace-sheet-states" role="group" aria-label="工作区阅读高度">
        <button type="button" aria-pressed={context.mode === 'reading'}
          title={context.mode === 'reading' ? '收起为紧凑高度' : '展开到阅读高度'}
          onClick={() => context.setMode(context.mode === 'reading' ? 'compact' : 'reading')}>阅读</button>
        <button type="button" className="workspace-icon" aria-label={fullscreen ? '返回地图分屏' : '全屏阅读工作区'}
          title={fullscreen ? '返回地图分屏' : '全屏阅读工作区'} onClick={() => fullscreen ? restore() : context.setMode('full')}>
          {fullscreen ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
        </button>
      </div> : null}
      <div className="workspace-panel-actions">
        {actions}
        {context && !context.compact ? <button type="button" className="workspace-icon"
          aria-label={context.mode === 'full' ? '返回地图分屏' : '全屏阅读工作区'} title={context.mode === 'full' ? '返回地图分屏' : '展开阅读'}
          onClick={() => {
            if (context.mode !== 'full') context.setMode('full');
            else if (context.restore) context.restore();
            else context.setMode('compact');
          }}>
          {context.mode === 'full' ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
        </button> : null}
        <button type="button" className="workspace-icon" aria-label={closeLabel} title={closeLabel} onClick={onClose}><X size={17} aria-hidden="true" /></button>
      </div>
    </div>
    {subtitle && !inlineSubtitle ? <p className="workspace-panel-subtitle">{subtitle}</p> : null}
  </header>;
}

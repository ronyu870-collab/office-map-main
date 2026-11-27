'use client';
import * as React from 'react';
import { ArrowLeft, ChevronDown, Maximize2, Minimize2, MoreHorizontal, X } from 'lucide-react';
import { IconButton } from '@/src/components/ui/IconButton';
import { MapDisclosure } from './MapDisclosure';
import type { SheetMode } from '../workspace/workspaceState';

export const WorkspacePanelContext = React.createContext<{
  compact: boolean; mode: SheetMode; setMode: (mode: SheetMode) => void; restore?: () => void; active?: boolean;
  backLabel?: string | null; onBack?: () => void;
} | null>(null);

/** Shared navigation belongs in the content title group, never in another toolbar above it. */
export function WorkspacePanelHeader({ title, subtitle, metadata, onClose, closeLabel, actions, primaryAction, titleId, titleRef }: {
  title: React.ReactNode; subtitle?: React.ReactNode; metadata?: React.ReactNode; onClose: () => void; closeLabel: string;
  actions?: React.ReactNode; primaryAction?: React.ReactNode; titleId?: string; titleRef?: React.Ref<HTMLHeadingElement>;
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
      {context?.backLabel ? <IconButton variant="ghost" size="sm" className="workspace-icon" onClick={context.onBack}
        label={`返回${context.backLabel}`}><ArrowLeft size={16} aria-hidden="true" /></IconButton> : null}
      <h2 id={titleId} ref={titleRef} title={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        {longTitle ? <button type="button" className="workspace-title-toggle" aria-expanded={titleExpanded}
          title={titleExpanded ? '收起完整名称' : '展开完整名称'} onClick={() => setExpandedTitle(titleExpanded ? null : title)}>
          <span className={titleExpanded ? 'workspace-title-expanded' : 'workspace-title-clamped'}>{title}</span><ChevronDown size={14} aria-hidden="true" />
        </button> : inlineSubtitle ? <span className="workspace-heading-inline"><span>{title}</span><span className="workspace-heading-meta">{subtitle}</span></span> : title}
      </h2>
      {primaryAction}
      {context?.compact ? <MapDisclosure width={264} active={context.active !== false} actionMenu className="workspace-mobile-tools" label={<><MoreHorizontal size={16} aria-hidden="true" /><span className="sr-only">工作区操作</span></>}>
        <div className="workspace-mobile-tool-options">
          <button type="button" aria-pressed={context.mode === 'reading'}
            onClick={() => context.setMode(context.mode === 'reading' ? 'compact' : 'reading')}>{context.mode === 'reading' ? '收起为摘要' : '展开到阅读高度'}</button>
          <button type="button" onClick={() => fullscreen ? restore() : context.setMode('full')}>{fullscreen ? '返回地图分屏' : '全屏阅读工作区'}</button>
          {React.Children.map(actions, child => {
            if (!React.isValidElement<{ children?: React.ReactNode; 'aria-label'?: string }>(child)) return child;
            const label = child.props['aria-label'];
            return label ? React.cloneElement(child, {}, <>{child.props.children}<span aria-hidden="true">{label}</span></>) : child;
          })}
        </div>
      </MapDisclosure> : null}
      <div className="workspace-panel-actions">
        {!context?.compact ? actions : null}
        {context && !context.compact ? <IconButton variant="ghost" size="sm" className="workspace-icon"
          label={context.mode === 'full' ? '返回地图分屏' : '全屏阅读工作区'} title={context.mode === 'full' ? '返回地图分屏' : '展开阅读'}
          onClick={() => {
            if (context.mode !== 'full') context.setMode('full');
            else if (context.restore) context.restore();
            else context.setMode('compact');
          }}>
          {context.mode === 'full' ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </IconButton> : null}
        <IconButton variant="ghost" size="sm" className="workspace-icon" label={closeLabel} onClick={onClose}><X size={16} aria-hidden="true" /></IconButton>
      </div>
    </div>
    {subtitle && !inlineSubtitle ? <p className="workspace-panel-subtitle">{subtitle}</p> : null}
    {metadata != null ? <div className="workspace-panel-metadata">{metadata}</div> : null}
  </header>;
}

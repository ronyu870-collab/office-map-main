'use client';

import * as React from 'react';
import { useAdminEditProtection } from './AdminEditProtection';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  BookOpen,
  Bug,
  ChevronRight,
  Database,
  FileClock,
  FileText,
  GitBranch,
  MessageSquareWarning,
  MonitorCog,
  StickyNote,
  UserRoundCog,
  Users,
  X,
} from 'lucide-react';

export type AdminSection =
  | 'database'
  | 'users'
  | 'submissions'
  | 'schema'
  | 'oss'
  | 'notice'
  | 'memo'
  | 'issues'
  | 'changelog'
  | 'logs'
  | 'debug'
  | 'impersonate'
  | 'display-overrides';

type NavItem = {
  key: AdminSection;
  label: string;
  icon: React.ReactNode;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export const ADMIN_SECTION_META: Record<AdminSection, { title: string; group: string }> = {
  users: { title: '用户管理', group: '用户' },
  impersonate: { title: '用户模拟', group: '用户' },
  database: { title: '数据库管理', group: '数据' },
  submissions: { title: '填报管理', group: '数据' },
  schema: { title: '数据关联', group: '数据' },
  oss: { title: '资料库管理', group: '数据' },
  logs: { title: '审计日志', group: '审计' },
  notice: { title: '系统公告', group: '系统' },
  memo: { title: '备忘录', group: '系统' },
  issues: { title: '需求反馈', group: '系统' },
  changelog: { title: '更新日志', group: '系统' },
  debug: { title: '数据诊断', group: '开发' },
  'display-overrides': { title: '显示覆盖规则', group: '开发' },
};

const GROUPS: NavGroup[] = [
  {
    label: '用户',
    items: [
      { key: 'users', label: '用户管理', icon: <Users size={15} /> },
      { key: 'impersonate', label: '用户模拟', icon: <UserRoundCog size={15} /> },
    ],
  },
  {
    label: '数据',
    items: [
      { key: 'database', label: '数据库管理', icon: <Database size={15} /> },
      { key: 'submissions', label: '填报管理', icon: <FileText size={15} /> },
      { key: 'schema', label: '数据关联', icon: <GitBranch size={15} /> },
      { key: 'oss', label: '资料库管理', icon: <BookOpen size={15} /> },
    ],
  },
  {
    label: '审计',
    items: [
      { key: 'logs', label: '审计日志', icon: <Activity size={15} /> },
    ],
  },
  {
    label: '系统',
    items: [
      { key: 'notice', label: '系统公告', icon: <Bell size={15} /> },
      { key: 'memo', label: '备忘录', icon: <StickyNote size={15} /> },
      { key: 'issues', label: '需求反馈', icon: <MessageSquareWarning size={15} /> },
      { key: 'changelog', label: '更新日志', icon: <FileClock size={15} /> },
    ],
  },
  {
    label: '开发',
    items: [
      { key: 'debug', label: '数据诊断', icon: <Bug size={15} /> },
      { key: 'display-overrides', label: '显示覆盖规则', icon: <MonitorCog size={15} /> },
    ],
  },
];

interface AdminSidebarProps {
  active: AdminSection;
  onChange?: (section: AdminSection) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function SidebarContents({ active, onChange, onMobileClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const { requestNavigation } = useAdminEditProtection();
  const select = (section: AdminSection) => {
    if (section === active && pathname === (section === 'display-overrides' ? '/admin/display-overrides' : '/admin')) {
      onMobileClose?.();
      return;
    }
    void requestNavigation(() => {
    if (section === 'display-overrides') {
      router.push('/admin/display-overrides');
    } else {
      onChange?.(section);
      router.push(`/admin?section=${section}`);
    }
    onMobileClose?.();
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-200 px-3 lg:hidden">
        <span className="text-[13px] font-semibold text-[var(--cd-color-text-primary)]">系统管理</span>
        <button type="button" onClick={onMobileClose} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label="关闭管理导航">
          <X size={16} />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="管理后台导航">
        {GROUPS.map((group) => (
          <section key={group.label} className="mb-4 last:mb-0">
            <h2 className="mb-1 px-2 text-[11px] font-medium text-[var(--cd-color-text-muted)]">{group.label}</h2>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const selected = active === item.key && (pathname === '/admin' || item.key === 'display-overrides');
                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => select(item.key)}
                    aria-current={selected ? 'page' : undefined}
                    className={`group flex w-full items-center gap-2 rounded-[var(--cd-radius-md)] border-l-2 px-2 py-2 text-left transition-colors ${selected ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]' : 'border-transparent text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)]'}`}
                  >
                    <span className={selected ? 'text-[var(--cd-color-brand)]' : 'text-[var(--cd-color-text-muted)] group-hover:text-[var(--cd-color-text-secondary)]'}>{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.label}</span>
                    {selected ? <ChevronRight size={13} className="text-[var(--cd-color-brand)]" /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </div>
  );
}

export function AdminSidebar(props: AdminSidebarProps) {
  return (
    <>
      <aside className="hidden w-[204px] shrink-0 border-r border-zinc-200 lg:block">
        <SidebarContents {...props} />
      </aside>
      {props.mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-[var(--cd-color-overlay)]" onClick={props.onMobileClose} aria-label="关闭管理导航遮罩" />
          <aside className="absolute inset-y-0 left-0 w-[260px] max-w-[84vw] border-r border-[var(--cd-color-border)] shadow-[var(--cd-shadow-drawer)]">
            <SidebarContents {...props} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

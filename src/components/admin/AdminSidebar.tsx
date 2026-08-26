'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  | 'impersonate';

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
  users: { title: '用户与权限', group: '用户与权限' },
  impersonate: { title: '用户模拟', group: '用户与权限' },
  database: { title: '数据库管理', group: '数据管理' },
  submissions: { title: '填报管理', group: '数据管理' },
  schema: { title: '数据关联', group: '数据管理' },
  oss: { title: '资料库管理', group: '数据管理' },
  logs: { title: '审计日志', group: '审计与活动' },
  notice: { title: '系统公告', group: '系统与运营' },
  memo: { title: '备忘录', group: '系统与运营' },
  issues: { title: '需求反馈', group: '系统与运营' },
  changelog: { title: '更新日志', group: '系统与运营' },
  debug: { title: '数据诊断', group: '开发与维护' },
};

const GROUPS: NavGroup[] = [
  {
    label: '用户与权限',
    items: [
      { key: 'users', label: '用户与权限', icon: <Users size={15} /> },
      { key: 'impersonate', label: '用户模拟', icon: <UserRoundCog size={15} /> },
    ],
  },
  {
    label: '数据管理',
    items: [
      { key: 'database', label: '数据库管理', icon: <Database size={15} /> },
      { key: 'submissions', label: '填报管理', icon: <FileText size={15} /> },
      { key: 'schema', label: '数据关联', icon: <GitBranch size={15} /> },
      { key: 'oss', label: '资料库管理', icon: <BookOpen size={15} /> },
    ],
  },
  {
    label: '审计与活动',
    items: [
      { key: 'logs', label: '审计日志', icon: <Activity size={15} /> },
    ],
  },
  {
    label: '系统与运营',
    items: [
      { key: 'notice', label: '系统公告', icon: <Bell size={15} /> },
      { key: 'memo', label: '备忘录', icon: <StickyNote size={15} /> },
      { key: 'issues', label: '需求反馈', icon: <MessageSquareWarning size={15} /> },
      { key: 'changelog', label: '更新日志', icon: <FileClock size={15} /> },
    ],
  },
  {
    label: '开发与维护',
    items: [
      { key: 'debug', label: '数据调试', icon: <Bug size={15} /> },
    ],
  },
];

interface AdminSidebarProps {
  active: AdminSection;
  onChange: (section: AdminSection) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function SidebarContents({ active, onChange, onMobileClose }: AdminSidebarProps) {
  const pathname = usePathname();

  const select = (section: AdminSection) => {
    onChange(section);
    onMobileClose?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-200 px-3 lg:hidden">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">系统管理</span>
        <button type="button" onClick={onMobileClose} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label="关闭管理导航">
          <X size={16} />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="管理后台导航">
        {GROUPS.map((group) => (
          <section key={group.label} className="mb-4 last:mb-0">
            <h2 className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{group.label}</h2>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const selected = pathname === '/admin' && active === item.key;
                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => select(item.key)}
                    aria-current={selected ? 'page' : undefined}
                    className={`group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${selected ? 'bg-[#003e7e] text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
                  >
                    <span className={selected ? 'text-white/80' : 'text-zinc-400 group-hover:text-zinc-600'}>{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{item.label}</span>
                    {selected ? <ChevronRight size={13} className="text-white/60" /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <section className="border-t border-zinc-200 pt-3">
          <h2 className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400">开发与维护</h2>
          <Link
            href="/admin/display-overrides"
            onClick={onMobileClose}
            aria-current={pathname === '/admin/display-overrides' ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-md px-2 py-2 transition ${pathname === '/admin/display-overrides' ? 'bg-[#003e7e] text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            <MonitorCog size={15} className={pathname === '/admin/display-overrides' ? 'text-white/80' : 'text-zinc-400'} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">显示覆盖规则</span>
          </Link>
        </section>
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
          <button type="button" className="absolute inset-0 bg-zinc-950/35" onClick={props.onMobileClose} aria-label="关闭管理导航遮罩" />
          <aside className="absolute inset-y-0 left-0 w-[260px] max-w-[84vw] border-r border-zinc-200 shadow-2xl">
            <SidebarContents {...props} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

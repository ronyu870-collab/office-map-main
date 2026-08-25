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
  description: string;
  icon: React.ReactNode;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export const ADMIN_SECTION_META: Record<AdminSection, { title: string; description: string; group: string }> = {
  users: { title: '用户与权限', description: '用户资料、角色、账号状态与任务归属。', group: '用户与权限' },
  impersonate: { title: '用户模拟', description: '以只读方式模拟现有用户的真实业务视角。', group: '用户与权限' },
  database: { title: '数据库管理', description: '维护系统现有核心业务表与记录。', group: '数据管理' },
  submissions: { title: '填报管理', description: '查看和管理现有季度填报记录。', group: '数据管理' },
  schema: { title: '数据关联', description: '查看现有数据表之间的关联结构。', group: '数据管理' },
  oss: { title: '资料库管理', description: '管理云端研究资料、目录和文件。', group: '数据管理' },
  logs: { title: '审计日志', description: '审阅系统已记录的操作和审计事件。', group: '审计与活动' },
  notice: { title: '系统公告', description: '维护系统公告和运营通知。', group: '系统与运营' },
  memo: { title: '备忘录', description: '维护后台现有备忘录内容。', group: '系统与运营' },
  issues: { title: '需求反馈', description: '处理用户提交的需求与问题反馈。', group: '系统与运营' },
  changelog: { title: '更新日志', description: '维护面向系统用户的更新记录。', group: '系统与运营' },
  debug: { title: '数据诊断', description: '开发与维护期间使用的数据诊断工具。', group: '开发与维护' },
};

const GROUPS: NavGroup[] = [
  {
    label: '用户与权限',
    items: [
      { key: 'users', label: '用户与权限', description: '账号、角色、状态', icon: <Users size={15} /> },
      { key: 'impersonate', label: '用户模拟', description: '只读业务视角', icon: <UserRoundCog size={15} /> },
    ],
  },
  {
    label: '数据管理',
    items: [
      { key: 'database', label: '数据库管理', description: '业务表与记录', icon: <Database size={15} /> },
      { key: 'submissions', label: '填报管理', description: '季度填报记录', icon: <FileText size={15} /> },
      { key: 'schema', label: '数据关联', description: '表关系结构', icon: <GitBranch size={15} /> },
      { key: 'oss', label: '资料库管理', description: '资料文件管理', icon: <BookOpen size={15} /> },
    ],
  },
  {
    label: '审计与活动',
    items: [
      { key: 'logs', label: '审计日志', description: '操作与活动记录', icon: <Activity size={15} /> },
    ],
  },
  {
    label: '系统与运营',
    items: [
      { key: 'notice', label: '系统公告', description: '运营通知', icon: <Bell size={15} /> },
      { key: 'memo', label: '备忘录', description: '内部备忘', icon: <StickyNote size={15} /> },
      { key: 'issues', label: '需求反馈', description: '问题与需求', icon: <MessageSquareWarning size={15} /> },
      { key: 'changelog', label: '更新日志', description: '发布记录', icon: <FileClock size={15} /> },
    ],
  },
  {
    label: '开发与维护',
    items: [
      { key: 'debug', label: '数据调试', description: '诊断与维护', icon: <Bug size={15} /> },
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
                    className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${selected ? 'bg-[#003e7e] text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
                  >
                    <span className={selected ? 'text-white/80' : 'text-zinc-400 group-hover:text-zinc-600'}>{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">{item.label}</span>
                      <span className={`block truncate text-[9px] ${selected ? 'text-white/55' : 'text-zinc-400'}`}>{item.description}</span>
                    </span>
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
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition ${pathname === '/admin/display-overrides' ? 'bg-[#003e7e] text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            <MonitorCog size={15} className={pathname === '/admin/display-overrides' ? 'text-white/80' : 'text-zinc-400'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">显示覆盖规则</span>
              <span className={`block truncate text-[9px] ${pathname === '/admin/display-overrides' ? 'text-white/55' : 'text-zinc-400'}`}>楼宇显示维护</span>
            </span>
          </Link>
        </section>
      </nav>
    </div>
  );
}

export function AdminSidebar(props: AdminSidebarProps) {
  return (
    <>
      <aside className="hidden w-[222px] shrink-0 border-r border-zinc-200 lg:block">
        <SidebarContents {...props} />
      </aside>
      {props.mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-zinc-950/35" onClick={props.onMobileClose} aria-label="关闭管理导航遮罩" />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[84vw] border-r border-zinc-200 shadow-2xl">
            <SidebarContents {...props} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

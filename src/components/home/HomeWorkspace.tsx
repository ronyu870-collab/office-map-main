'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ChevronDown,
  ClipboardList,
  Database,
  FileSearch,
  Handshake,
  LogOut,
  Map,
  Settings,
  UserRound,
} from 'lucide-react';

import { CommunicationBoard } from '@/src/components/CommunicationBoard';
import { NoticeBanner } from '@/src/components/NoticeBanner';
import { WorkspaceShell } from '@/src/components/layout';
import { Badge } from '@/src/components/ui';
import { useAppSession } from '@/src/components/SessionProvider';
import { isDemoMode } from '@/src/config/demoMode';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { signOut } from '@/src/services/Auth';
import { logAction, logActionImmediate } from '@/src/utils/audit';
import {
  canAccessModule,
  getAccessibilityProps,
  isModuleRestricted,
  isUserAdmin,
} from '@/src/utils/accessControl';

type UnderDevelopmentModule = { module: string; href: string };
const UNDER_DEVELOPMENT_MODULES: UnderDevelopmentModule[] = [];

type WorkspaceModule = {
  href: string;
  module: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

const MAP_WORKSPACE: WorkspaceModule = {
  href: '/map',
  module: 'map',
  title: '北京办公楼市场地图',
  description: '查询楼宇、租金、空置率、供应及子市场数据。',
  icon: Map,
};

const BUSINESS_WORKSPACES: WorkspaceModule[] = [
  {
    href: '/update',
    module: 'update',
    title: '季度数据填报',
    description: '维护楼宇租金、空置率及季度数据。',
    icon: ClipboardList,
  },
  {
    href: '/lease-submission',
    module: 'lease-submission',
    title: '租赁成交填报',
    description: '录入成交信息并完成数据检查。',
    icon: Handshake,
  },
  {
    href: '/oss',
    module: 'oss',
    title: '研究资料库',
    description: '查找市场报告、研究文件及团队资料。',
    icon: FileSearch,
  },
];

const ADMIN_WORKSPACE: WorkspaceModule = {
  href: '/admin',
  module: 'admin',
  title: '系统管理',
  description: '管理数据库、用户、审计记录与系统配置。',
  icon: Database,
};

function UnderDevelopmentModal({ isOpen, onClose, moduleName }: { isOpen: boolean; onClose: () => void; moduleName: string }) {
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  React.useEffect(() => { if (isOpen) closeButtonRef.current?.focus(); }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--cd-z-modal)] flex items-center justify-center bg-black/45 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="home-dev-modal-title" className="w-full max-w-md rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-6 shadow-[var(--cd-shadow-overlay)]">
        <h2 id="home-dev-modal-title" className="text-base font-semibold text-[var(--cd-color-text-primary)]">功能开发中</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--cd-color-text-secondary)]">{moduleName} 正在开发中。管理员可以继续测试，其他用户暂时不可进入。</p>
        <button ref={closeButtonRef} type="button" onClick={onClose} className="mt-5 h-9 w-full rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--cd-color-brand-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]">我知道了</button>
      </div>
    </div>
  );
}

function getRoleLabel(role: string, isAdmin: boolean) {
  if (isAdmin) return '管理员';
  if (role === 'editor') return '编辑用户';
  if (role === 'viewer') return '查看用户';
  return '内部用户';
}

function HomeHeader({
  displayName,
  role,
  email,
  canSeeAdminWorkspace,
  onLogout,
  onAdminActivate,
}: {
  displayName: string;
  role: string;
  email?: string;
  canSeeAdminWorkspace: boolean;
  onLogout: () => void;
  onAdminActivate: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const isRestrictedAdmin = email === 'judy.li@colliers.com';
  const isAdmin = isUserAdmin(role) && !isRestrictedAdmin;
  const roleLabel = getRoleLabel(role, isAdmin);
  const adminCanAccess = canAccessModule(ADMIN_WORKSPACE.module, role);
  const adminAccessibilityProps = getAccessibilityProps(ADMIN_WORKSPACE.module, ADMIN_WORKSPACE.title, role);

  React.useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      requestAnimationFrame(() => menuTriggerRef.current?.focus());
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const focusFirstMenuItem = () => {
    requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    });
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (event.key === 'Tab') setMenuOpen(false);
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
    );
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Home') {
      items[0].focus();
      return;
    }
    if (event.key === 'End') {
      items[items.length - 1].focus();
      return;
    }

    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? (offset > 0 ? 0 : items.length - 1)
      : (currentIndex + offset + items.length) % items.length;
    items[nextIndex].focus();
  };

  return (
    <div className="mx-auto flex h-[54px] w-full max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-7 w-[52px] shrink-0 overflow-hidden rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-brand)]">
          <Image src={COLLIERS_LOGO_DATA_URI} alt="Colliers 高力国际" width={592} height={337} priority className="absolute left-1/2 top-1/2 h-[31px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2" />
        </div>
        <span className="h-4 w-px bg-[var(--cd-color-border)]" aria-hidden="true" />
        <div className="truncate text-[13px] font-medium text-[var(--cd-color-text-primary)] sm:text-sm">北京办公楼市场数据平台</div>
      </div>

      <div
        ref={menuRef}
        className="relative shrink-0"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
        }}
      >
        <button
          ref={menuTriggerRef}
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            setMenuOpen(true);
            focusFirstMenuItem();
          }}
          className="inline-flex h-10 max-w-48 items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-2 text-[13px] text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:h-9"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="home-user-menu"
          aria-label="用户菜单"
        >
          <UserRound size={16} strokeWidth={1.55} className="sm:hidden" aria-hidden="true" />
          <span className="hidden max-w-36 truncate sm:inline" title={displayName}>{displayName}</span>
          <ChevronDown size={14} strokeWidth={1.55} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>

        {menuOpen ? (
          <div
            id="home-user-menu"
            role="menu"
            aria-label="账户操作"
            onKeyDown={handleMenuKeyDown}
            className="absolute right-0 top-full z-[var(--cd-z-dropdown)] mt-2 w-52 overflow-hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-popover)]"
          >
            <div className="border-b border-[var(--cd-color-border)] px-3.5 py-3">
              <div className="truncate text-[13px] font-medium text-[var(--cd-color-text-primary)]" title={displayName}>{displayName}</div>
              <div className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">{roleLabel}</div>
            </div>

            <div className="p-1.5">
              <Link
                href="/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-10 items-center gap-2 rounded-[var(--cd-radius-sm)] px-2.5 text-[13px] text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
              >
                <Settings size={14} strokeWidth={1.55} aria-hidden="true" />
                设置
              </Link>

              {canSeeAdminWorkspace ? (
                <Link
                  href={ADMIN_WORKSPACE.href}
                  role="menuitem"
                  onClick={(event) => {
                    setMenuOpen(false);
                    onAdminActivate(event);
                  }}
                  className={`flex min-h-10 items-center gap-2 rounded-[var(--cd-radius-sm)] px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20 ${adminCanAccess ? 'text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)]' : 'cursor-not-allowed text-[var(--cd-color-text-muted)] opacity-60'}`}
                  {...adminAccessibilityProps}
                >
                  <Database size={14} strokeWidth={1.55} aria-hidden="true" />
                  <span>系统管理</span>
                  {!adminCanAccess ? <span className="ml-auto text-[11px]">无权限</span> : null}
                </Link>
              ) : null}
            </div>

            <div className="border-t border-[var(--cd-color-border)] p-1.5">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-[var(--cd-radius-sm)] px-2.5 text-left text-[13px] text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
              >
                <LogOut size={14} strokeWidth={1.55} aria-hidden="true" />
                退出登录
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace, role, onActivate }: { workspace: WorkspaceModule; role: string; onActivate: (event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) => void }) {
  const Icon = workspace.icon;
  const canAccess = canAccessModule(workspace.module, role);
  const isUnderDevelopment = UNDER_DEVELOPMENT_MODULES.some(({ module }) => module === workspace.module);
  const accessibilityProps = getAccessibilityProps(workspace.module, workspace.title, role);

  return (
    <Link
      href={workspace.href}
      onClick={(event) => onActivate(event, workspace)}
      className={`group flex min-h-[80px] items-center gap-3.5 border-b border-[var(--cd-color-border)] px-4 py-3.5 transition-colors last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cd-color-brand)] sm:px-5 ${canAccess ? 'hover:bg-[var(--cd-color-surface-alt)]' : 'cursor-not-allowed opacity-55'}`}
      title={canAccess ? undefined : '当前账号无访问权限'}
      {...accessibilityProps}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-secondary)] transition-colors group-hover:text-[var(--cd-color-brand)]">
        <Icon size={17} strokeWidth={1.55} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-medium text-[var(--cd-color-text-primary)] sm:text-[15px]">{workspace.title}</h3>
          {isUnderDevelopment ? <Badge tone="warning">开发中</Badge> : null}
        </div>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--cd-color-text-secondary)]">{workspace.description}</p>
      </div>
      {canAccess ? (
        <ArrowRight size={15} strokeWidth={1.55} className="shrink-0 text-[var(--cd-color-text-muted)] transition-colors group-hover:text-[var(--cd-color-brand)]" aria-hidden="true" />
      ) : (
        <span className="shrink-0 text-xs text-[var(--cd-color-text-muted)]">无访问权限</span>
      )}
    </Link>
  );
}

function HomeLoadingShell() {
  return (
    <WorkspaceShell className="h-screen h-[100dvh] overflow-hidden" header={<div className="mx-auto flex h-[54px] w-full max-w-[1240px] items-center justify-between px-4 sm:px-6 lg:px-8"><div className="h-5 w-44 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" /><div className="h-8 w-20 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" /></div>}>
      <div className="h-full overflow-hidden p-4 sm:p-6 lg:p-8">
        <div className="mx-auto grid h-full max-w-[1240px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5">
            <div className="h-28 animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)]" />
            <div className="h-5 w-20 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" />
            <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)]">
              {[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] last:border-b-0" />)}
            </div>
          </div>
          <div className="hidden h-80 animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)] lg:block" />
        </div>
      </div>
    </WorkspaceShell>
  );
}

export function HomeWorkspace() {
  const router = useRouter();
  const { session: ctx, status } = useAppSession();
  const [showDevModal, setShowDevModal] = React.useState(false);
  const [clickedModule, setClickedModule] = React.useState('');
  const [showCommunication, setShowCommunication] = React.useState(false);

  React.useEffect(() => { if (status === 'unauthenticated') router.replace('/login'); }, [router, status]);
  React.useEffect(() => {
    if (status !== 'authenticated') { setShowCommunication(false); return; }
    React.startTransition(() => setShowCommunication(true));
  }, [status]);

  if (status === 'loading' || !ctx) return <HomeLoadingShell />;

  const activeSession = ctx;
  const isRestrictedAdmin = activeSession.user.email === 'judy.li@colliers.com';
  const isAdmin = isUserAdmin(activeSession.role) && !isRestrictedAdmin;
  const canSeeAdminWorkspace = isAdmin || isDemoMode(activeSession.user.email);

  async function handleLogout() {
    try {
      if (activeSession.user.email) await logActionImmediate(activeSession.user.email, 'LOGOUT', { platform: 'web' });
      await signOut();
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  }

  function evaluateWorkspace(event: { preventDefault: () => void }, workspace: WorkspaceModule) {
    const restricted = isModuleRestricted(workspace.module);
    const admin = isUserAdmin(activeSession.role);
    const canAccess = canAccessModule(workspace.module, activeSession.role);

    if (activeSession.user.email) {
      const details: Record<string, unknown> = { module: workspace.module, blocked: !canAccess };
      if (restricted && !admin) details.reason = 'restricted_module';
      logAction(activeSession.user.email, 'ENTER_MODULE', details);
    }

    if (!canAccess) { event.preventDefault(); return; }

    const underDevelopment = UNDER_DEVELOPMENT_MODULES.some(({ module }) => module === workspace.module);
    if (underDevelopment && !admin) {
      event.preventDefault();
      setClickedModule(workspace.title);
      setShowDevModal(true);
    }
  }

  function handleWorkspaceActivation(event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) {
    evaluateWorkspace(event, workspace);
  }

  const MapIcon = MAP_WORKSPACE.icon;
  const mapAccessibilityProps = getAccessibilityProps(MAP_WORKSPACE.module, MAP_WORKSPACE.title, activeSession.role);

  return (
    <>
      <WorkspaceShell
        className="h-screen h-[100dvh] overflow-hidden"
        header={(
          <HomeHeader
            displayName={activeSession.displayName}
            role={activeSession.role}
            email={activeSession.user.email}
            canSeeAdminWorkspace={canSeeAdminWorkspace}
            onLogout={() => void handleLogout()}
            onAdminActivate={(event) => handleWorkspaceActivation(event, ADMIN_WORKSPACE)}
          />
        )}
      >
        <div className="h-full overflow-y-auto overscroll-contain">
          <div className="mx-auto grid min-h-full w-full max-w-[1240px] grid-cols-1 gap-8 px-4 py-6 sm:px-6 sm:py-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:px-8 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-9">
            <section className="min-w-0" aria-labelledby="home-heading">
              <Link
                href={MAP_WORKSPACE.href}
                onClick={(event) => handleWorkspaceActivation(event, MAP_WORKSPACE)}
                className="group flex min-h-[104px] items-center gap-4 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border-strong)] bg-[var(--cd-color-surface)] px-4 py-4 transition-colors hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:px-5"
                {...mapAccessibilityProps}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]">
                  <MapIcon size={20} strokeWidth={1.6} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 id="home-heading" className="text-base font-semibold text-[var(--cd-color-text-primary)]">{MAP_WORKSPACE.title}</h1>
                  <p className="mt-1 text-[13px] leading-5 text-[var(--cd-color-text-secondary)] sm:text-sm">{MAP_WORKSPACE.description}</p>
                </div>
                <div className="hidden shrink-0 items-center gap-1.5 text-[13px] font-medium text-[var(--cd-color-brand)] sm:flex">进入地图<ArrowRight size={15} strokeWidth={1.6} aria-hidden="true" /></div>
                <ArrowRight size={16} strokeWidth={1.6} className="shrink-0 text-[var(--cd-color-brand)] sm:hidden" aria-hidden="true" />
              </Link>

              <div className="mb-2.5 mt-5">
                <h2 className="text-[14px] font-semibold text-[var(--cd-color-text-primary)]">常用工作</h2>
              </div>
              <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
                {BUSINESS_WORKSPACES.map((workspace) => <WorkspaceCard key={workspace.href} workspace={workspace} role={activeSession.role} onActivate={handleWorkspaceActivation} />)}
              </div>
            </section>

            <aside className="min-w-0 border-t border-[var(--cd-color-border)] pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0 xl:pl-7" aria-label="团队动态">
              <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--cd-color-text-primary)]">团队动态</h2>
              <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
                {showCommunication ? <NoticeBanner /> : <div className="h-12 animate-pulse border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]" />}
                <div className="h-[240px] sm:h-[250px] lg:h-[270px]">
                  {showCommunication && activeSession.user.email ? <CommunicationBoard userEmail={activeSession.user.email} userName={activeSession.displayName} /> : <div className="h-full animate-pulse bg-[var(--cd-color-surface-alt)]" aria-hidden="true" />}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </WorkspaceShell>

      <UnderDevelopmentModal isOpen={showDevModal} onClose={() => { setShowDevModal(false); setClickedModule(''); }} moduleName={clickedModule} />
    </>
  );
}

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
  FileText,
  Handshake,
  LogOut,
  Map,
  Lock,
  Sparkles,
  UserRound,
} from 'lucide-react';

import { WorkspaceShell } from '@/src/components/layout';
import type { HomeTeamActivityProps } from './HomeTeamActivity';
import { useAppSession, useCanStartHomeNavigation } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { isDemoMode } from '@/src/config/demoMode';
import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import { canSeeOccupierReportCard } from '@/src/config/occupierReportCard';
import { signOut } from '@/src/services/Auth';
import { getUserRoleLabel, parseUserRole, type UserRole } from '@/src/types/auth';
import { canAccessAdminConsole } from '@/src/utils/adminAccess';
import { logAction, logActionImmediate } from '@/src/utils/audit';
import {
  canAccessModule,
  getAccessibilityProps,
  isModuleRestricted,
} from '@/src/utils/accessControl';

type WorkspaceModule = {
  href: string;
  module: string;
  title: string;
  badge?: string;
  /** 首页入口的可见范围；缺省表示所有合法角色都能看到。 */
  homeVisibility?: 'occupier-report';
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

const MAP_WORKSPACE: WorkspaceModule = {
  href: '/map',
  module: 'map',
  title: '北京办公楼市场地图',
  icon: Map,
};

const INTELLIGENCE_WORKSPACE: WorkspaceModule = {
  href: '/intelligence',
  module: 'intelligence',
  title: '业务智能 Intelligence',
  icon: Sparkles,
};

const BUSINESS_WORKSPACES: WorkspaceModule[] = [
  {
    href: '/update',
    module: 'update',
    title: '季度数据填报',
    icon: ClipboardList,
  },
  {
    href: '/lease-submission',
    module: 'lease-submission',
    title: '租赁成交填报',
    icon: Handshake,
  },
  {
    href: '/oss',
    module: 'oss',
    title: '研究资料库',
    icon: FileSearch,
  },
  {
    href: '/occupier-insights',
    module: 'occupier-insights',
    title: '企业选址洞察报告',
    homeVisibility: 'occupier-report',
    icon: FileText,
    badge: '专题',
  },
];

const ADMIN_WORKSPACE: WorkspaceModule = {
  href: '/admin',
  module: 'admin',
  title: '系统管理',
  icon: Database,
};

function HomeHeader({
  displayName,
  role,
  canSeeAdminWorkspace,
  onLogout,
  onAdminActivate,
}: {
  displayName: string;
  role: UserRole;
  canSeeAdminWorkspace: boolean;
  onLogout: () => void;
  onAdminActivate: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const focusFirstOnOpenRef = React.useRef(false);
  const roleLabel = getUserRoleLabel(role);

  const focusFirstMenuItem = React.useCallback(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, []);

  React.useEffect(() => {
    if (!menuOpen || !focusFirstOnOpenRef.current) return;
    focusFirstOnOpenRef.current = false;
    focusFirstMenuItem();
  }, [focusFirstMenuItem, menuOpen]);

  React.useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

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
    <div className="mx-auto flex h-[54px] w-full max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 2xl:max-w-[1360px]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-7 w-[52px] shrink-0 overflow-hidden rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-brand)]">
          <Image src="/colliers-logo.png" unoptimized alt="Colliers 高力国际" width={592} height={337} priority className="absolute left-1/2 top-1/2 h-[31px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2" />
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
            if (menuOpen) {
              focusFirstMenuItem();
              return;
            }
            focusFirstOnOpenRef.current = true;
            setMenuOpen(true);
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
                <Lock size={14} strokeWidth={1.55} aria-hidden="true" />
                修改密码
              </Link>

              {canSeeAdminWorkspace ? (
                <Link
                  href={ADMIN_WORKSPACE.href}
                  role="menuitem"
                  onClick={(event) => {
                    setMenuOpen(false);
                    onAdminActivate(event);
                  }}
                  className="flex min-h-10 items-center gap-2 rounded-[var(--cd-radius-sm)] px-2.5 text-[13px] text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
                >
                  <Database size={14} strokeWidth={1.55} aria-hidden="true" />
                  <span>系统管理</span>
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

function WorkspaceCard({ workspace, role, onActivate }: { workspace: WorkspaceModule; role: UserRole; onActivate: (event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) => void }) {
  const Icon = workspace.icon;
  const canAccess = canAccessModule(workspace.module, role);
  const accessibilityProps = getAccessibilityProps(workspace.module, workspace.title, role);

  return (
    <Link
      href={workspace.href}
      onClick={(event) => onActivate(event, workspace)}
      className={`group flex min-h-[64px] items-center gap-3.5 border-b border-[var(--cd-color-border)] px-4 py-3 transition-colors last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cd-color-brand)] sm:px-5 ${canAccess ? 'hover:bg-[var(--cd-color-surface-alt)]' : 'cursor-not-allowed opacity-55'}${workspace.badge ? ' relative' : ''}`}
      title={canAccess ? undefined : '当前账号无访问权限'}
      {...accessibilityProps}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-secondary)] transition-colors group-hover:text-[var(--cd-color-brand)]">
        <Icon size={17} strokeWidth={1.55} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-medium text-[var(--cd-color-text-primary)] sm:text-[15px]">{workspace.title}</h3>
      </div>
      {workspace.badge ? (
        <span aria-hidden="true" className="absolute right-4 top-1.5 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-1.5 text-xs leading-4 text-[var(--cd-color-text-secondary)] sm:right-5">
          {workspace.badge}
        </span>
      ) : null}
      {canAccess ? (
        <ArrowRight size={15} strokeWidth={1.55} className="shrink-0 text-[var(--cd-color-text-muted)] transition-colors group-hover:text-[var(--cd-color-brand)]" aria-hidden="true" />
      ) : (
        <span className="shrink-0 text-xs text-[var(--cd-color-text-muted)]">无访问权限</span>
      )}
    </Link>
  );
}

function LoadingHeader() {
  return (
    <div className="mx-auto flex h-[54px] w-full max-w-[1240px] items-center justify-between px-4 sm:px-6 lg:px-8 2xl:max-w-[1360px]">
      <div className="h-7 w-[220px] max-w-[calc(100%-64px)] animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)] sm:w-[231px]" />
      <div className="h-10 w-[52px] animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)] sm:h-9 sm:w-[88px]" />
    </div>
  );
}

function LoadingActivity() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
      <div className="h-12 animate-pulse border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]" />
      <div className="h-[240px] animate-pulse bg-[var(--cd-color-surface-alt)] sm:h-[250px] lg:h-[270px]" />
    </div>
  );
}

const HomeTeamActivity = React.lazy(() => import('./HomeTeamActivity').then(module => ({
  default: module.HomeTeamActivity,
})));

function DeferredHomeActivity(props: HomeTeamActivityProps) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let afterPaint = 0;
    const frame = requestAnimationFrame(() => {
      afterPaint = requestAnimationFrame(() => React.startTransition(() => setReady(true)));
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(afterPaint); };
  }, []);
  return ready ? (
    <React.Suspense fallback={<LoadingActivity />}><HomeTeamActivity {...props} /></React.Suspense>
  ) : <LoadingActivity />;
}

export function HomeWorkspace() {
  const router = useRouter();
  const { session: ctx, status } = useAppSession();
  const { isImpersonating } = useImpersonation();
  const canStartNavigation = useCanStartHomeNavigation();

  const activeSession = status === 'authenticated' && !ctx?.user.app_metadata?.must_change_password ? ctx : null;
  const canStartMap = Boolean(activeSession) ||
    (canStartNavigation && !isImpersonating && !isModuleRestricted(MAP_WORKSPACE.module));

  React.useEffect(() => { if (status === 'unauthenticated') router.replace('/login'); }, [router, status]);

  const activeRole = parseUserRole(activeSession?.role) ?? 'viewer';
  const canSeeAdminWorkspace = Boolean(activeSession && canAccessAdminConsole({
    role: activeRole,
    isDemo: isDemoMode(activeSession.user.email),
    impersonationActive: isImpersonating,
  }));
  const canSeeIntelligence = Boolean(activeSession && isIntelligencePreviewEnabled(activeRole));
  // This card's visibility does not change the report's public access.
  const visibleBusinessWorkspaces = activeSession ? BUSINESS_WORKSPACES.filter(workspace =>
    workspace.homeVisibility !== 'occupier-report'
    || canSeeOccupierReportCard(activeRole, activeSession.user.email),
  ) : [];

  async function handleLogout() {
    if (!activeSession) return;
    try {
      if (activeSession.user.email) void logActionImmediate(activeSession.user.email, 'LOGOUT', { platform: 'web' });
      await signOut();
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  }

  function handleWorkspaceActivation(event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) {
    if (!activeSession) { event.preventDefault(); return; }
    const restricted = isModuleRestricted(workspace.module);
    const canAccess = workspace.module === ADMIN_WORKSPACE.module
      ? canSeeAdminWorkspace
      : canAccessModule(workspace.module, activeRole);

    if (!canAccess) {
      event.preventDefault();
      if (activeSession.user.email) {
        const details: Record<string, unknown> = { module: workspace.module, blocked: true };
        if (restricted && activeRole !== 'admin') details.reason = 'restricted_module';
        logAction(activeSession.user.email, 'ACCESS_DENIED', details);
      }
    }
  }

  const MapIcon = MAP_WORKSPACE.icon;
  const mapAccessibilityProps = getAccessibilityProps(MAP_WORKSPACE.module, MAP_WORKSPACE.title, activeRole);
  const IntelligenceIcon = INTELLIGENCE_WORKSPACE.icon;
  const intelligenceAccessibilityProps = getAccessibilityProps(INTELLIGENCE_WORKSPACE.module, INTELLIGENCE_WORKSPACE.title, activeRole);

  return (
    <WorkspaceShell
      className="h-screen h-[100dvh] overflow-hidden"
      header={activeSession ? (
        <HomeHeader
          displayName={activeSession.displayName}
          role={activeRole}
          canSeeAdminWorkspace={canSeeAdminWorkspace}
          onLogout={() => void handleLogout()}
          onAdminActivate={(event) => handleWorkspaceActivation(event, ADMIN_WORKSPACE)}
        />
      ) : <LoadingHeader />}
    >
      <div className="h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto grid min-h-full w-full max-w-[1240px] grid-cols-1 gap-8 px-4 py-6 sm:px-6 sm:py-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:px-8 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-9 2xl:max-w-[1360px]">
          <section className="min-w-0" aria-labelledby={canStartMap ? 'home-heading' : undefined}>
            <div className={`grid gap-3 ${canSeeIntelligence || !canStartMap ? 'sm:grid-cols-2' : ''}`}>
              {canStartMap ? <Link
                href={MAP_WORKSPACE.href}
                prefetch={activeSession ? undefined : false}
                onClick={activeSession ? (event) => handleWorkspaceActivation(event, MAP_WORKSPACE) : undefined}
                className="group flex min-h-[84px] items-center gap-4 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border-strong)] bg-[var(--cd-color-surface)] px-4 py-4 transition-colors hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:px-5"
                {...mapAccessibilityProps}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]">
                  <MapIcon size={20} strokeWidth={1.6} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 id="home-heading" className="text-base font-semibold text-[var(--cd-color-text-primary)]">{MAP_WORKSPACE.title}</h1>
                </div>
                <ArrowRight size={16} strokeWidth={1.6} className="shrink-0 text-[var(--cd-color-brand)]" aria-hidden="true" />
              </Link> : <div aria-hidden="true" className="h-[84px] animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)]" />}

              {!canStartMap && <div aria-hidden="true" className="h-[84px] animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)]" />}
              {canSeeIntelligence ? (
                <Link
                  href={INTELLIGENCE_WORKSPACE.href}
                  onClick={(event) => handleWorkspaceActivation(event, INTELLIGENCE_WORKSPACE)}
                  className="group flex min-h-[84px] items-center gap-4 rounded-[var(--cd-radius-lg)] border border-[color:rgb(0_62_126_/_0.24)] bg-[var(--cd-color-surface)] px-4 py-4 transition-colors hover:bg-[var(--cd-color-brand-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:px-5"
                  {...intelligenceAccessibilityProps}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]">
                    <IntelligenceIcon size={20} strokeWidth={1.6} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="text-base font-semibold text-[var(--cd-color-text-primary)]">{INTELLIGENCE_WORKSPACE.title}</h2>
                      <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-brand-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--cd-color-brand)]">Pilot Preview</span>
                    </div>
                  </div>
                  <ArrowRight size={16} strokeWidth={1.6} className="shrink-0 text-[var(--cd-color-brand)]" aria-hidden="true" />
                </Link>
              ) : null}
            </div>

            {activeSession ? (
              <>
                <div className="mb-2.5 mt-5">
                  <h2 className="text-[14px] font-semibold text-[var(--cd-color-text-primary)]">常用工作</h2>
                </div>
                <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
                  {visibleBusinessWorkspaces.map((workspace) => <WorkspaceCard key={workspace.href} workspace={workspace} role={activeRole} onActivate={handleWorkspaceActivation} />)}
                </div>
              </>
            ) : (
              <div aria-hidden="true">
                <div className="mb-2.5 mt-5 h-5 w-20 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" />
                <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)]">
                  {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] last:border-b-0" />)}
                </div>
              </div>
            )}
          </section>

          <aside className={`min-w-0 border-t border-[var(--cd-color-border)] pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0 xl:pl-7 ${activeSession ? '' : 'hidden lg:block'}`} aria-label="团队动态" aria-hidden={!activeSession || undefined}>
            {activeSession ? <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--cd-color-text-primary)]">团队动态</h2>
              : <div aria-hidden="true" className="mb-2.5 h-5 w-20 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" />}
            {activeSession ? (
              <DeferredHomeActivity
                key={activeSession.user.id}
                userId={activeSession.user.id}
                userEmail={activeSession.user.email ?? ''}
                userName={activeSession.displayName}
              />
            ) : <LoadingActivity />}
          </aside>
        </div>
      </div>
    </WorkspaceShell>
  );
}

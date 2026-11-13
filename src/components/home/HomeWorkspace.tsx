'use client';

import { BrokerSearchLink } from '@/src/components/BrokerSearchLink';
import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowUp,
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
import { HomeIntentLink } from './HomeIntentLink';
import styles from './HomeWorkspace.module.css';
import type { HomeTeamActivityProps } from './HomeTeamActivity';
import { useAppSession, useCanStartHomeNavigation } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { isDemoMode } from '@/src/config/demoMode';
import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import { canReadQuarterlyResearch } from '@/src/config/quarterlyResearch';
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
  /** 首页入口的可见范围；缺省表示所有合法角色都能看到。 */
  homeVisibility?: 'occupier-report' | 'admin-research';
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
  { href: '/quarterly-research', module: 'quarterly-research', title: '北京写字楼季度研究', homeVisibility: 'admin-research', icon: FileText },
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
    <div className="mx-auto flex h-[54px] w-full max-w-[1176px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-7 w-[52px] shrink-0 overflow-hidden rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-brand)]">
          <Image src="/colliers-logo.png" unoptimized alt="Colliers 高力国际" width={592} height={337} priority className="absolute left-1/2 top-1/2 h-[31px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2" />
        </div>
        <span className="h-4 w-px bg-[var(--cd-color-border)]" aria-hidden="true" />
        <div className="truncate text-sm font-medium text-[var(--cd-color-text-primary)] sm:text-sm">北京办公楼市场数据平台</div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="[&>a]:min-w-11 [&>a]:justify-center">
          <BrokerSearchLink />
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
            className="inline-flex h-11 max-w-48 items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-2 text-sm text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:h-9"
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
                <div className="truncate text-sm font-medium text-[var(--cd-color-text-primary)]" title={displayName}>{displayName}</div>
                <div className="mt-0.5 text-sm text-[var(--cd-color-text-muted)]">{roleLabel}</div>
              </div>

              <div className="p-1.5">
                <HomeIntentLink
                  href="/settings"
                  mayPrefetch
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-10 items-center gap-2 rounded-[var(--cd-radius-sm)] px-2.5 text-sm text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
                >
                  <Lock size={14} strokeWidth={1.55} aria-hidden="true" />
                  修改密码
                </HomeIntentLink>

                {canSeeAdminWorkspace ? (
                  <HomeIntentLink
                    href={ADMIN_WORKSPACE.href}
                    mayPrefetch
                    role="menuitem"
                    onClick={(event) => {
                      setMenuOpen(false);
                      onAdminActivate(event);
                    }}
                    className="flex min-h-10 items-center gap-2 rounded-[var(--cd-radius-sm)] px-2.5 text-sm text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
                  >
                    <Database size={14} strokeWidth={1.55} aria-hidden="true" />
                    <span>系统管理</span>
                  </HomeIntentLink>
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
                  className="flex min-h-10 w-full items-center gap-2 rounded-[var(--cd-radius-sm)] px-2.5 text-left text-sm text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/20"
                >
                  <LogOut size={14} strokeWidth={1.55} aria-hidden="true" />
                  退出登录
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace, role, onActivate }: { workspace: WorkspaceModule; role: UserRole; onActivate: (event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) => void }) {
  const Icon = workspace.icon;
  const canAccess = canAccessModule(workspace.module, role);
  const accessibilityProps = getAccessibilityProps(workspace.module, workspace.title, role);

  return (
    <HomeIntentLink
      href={workspace.href}
      mayPrefetch={canAccess}
      onClick={(event) => onActivate(event, workspace)}
      className={`${styles.workspaceLink} ${canAccess ? '' : styles.unavailable}`}
      title={canAccess ? undefined : '当前账号无访问权限'}
      {...accessibilityProps}
    >
      <Icon size={22} strokeWidth={1.5} className={styles.workspaceIcon} aria-hidden="true" />
      <h3>{workspace.title}</h3>
      {canAccess ? <ArrowRight size={16} strokeWidth={1.5} className={styles.linkArrow} aria-hidden="true" />
        : <span>无访问权限</span>}
    </HomeIntentLink>
  );
}

function LoadingHeader() {
  return (
    <div className="mx-auto flex h-[54px] w-full max-w-[1176px] items-center justify-between px-4 sm:px-6 lg:px-8">
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
    workspace.homeVisibility === 'admin-research'
      ? canReadQuarterlyResearch(activeRole, isImpersonating)
      : workspace.homeVisibility !== 'occupier-report' || canSeeOccupierReportCard(activeRole, activeSession.user.email),
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
      className={`h-screen h-[100dvh] overflow-hidden ${styles.shell}`}
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
      <div className={styles.scrollArea}>
        <div className={styles.page}>
          <section aria-labelledby="home-title" className={styles.primary}>
            <h1 id="home-title" className="sr-only">主页</h1>
            <div className={styles.workSurface}>
              <div className={styles.queryArea}>
                {activeSession ? <>
                  <div className={styles.queryHeading}>
                    <label htmlFor="home-query">对话查询</label>
                    {canSeeIntelligence ? <HomeIntentLink
                      href={INTELLIGENCE_WORKSPACE.href}
                      mayPrefetch={canAccessModule(INTELLIGENCE_WORKSPACE.module, activeRole)}
                      onClick={(event) => handleWorkspaceActivation(event, INTELLIGENCE_WORKSPACE)}
                      className={styles.intelligenceLink}
                      aria-label={INTELLIGENCE_WORKSPACE.title}
                      {...intelligenceAccessibilityProps}
                    >
                      <IntelligenceIcon size={16} strokeWidth={1.5} aria-hidden="true" />
                      <span>业务智能</span><span className={styles.previewLabel}>内部试用</span>
                      <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
                    </HomeIntentLink> : null}
                  </div>
                  <div className={styles.composer}>
                    <textarea id="home-query" aria-describedby="home-query-status" disabled rows={2} placeholder="对话查询尚未开放" />
                    <div className={styles.composerFooter}>
                      <p id="home-query-status">目前请使用下方业务入口。</p>
                      <button type="button" disabled aria-label="发送问题"><ArrowUp size={18} strokeWidth={1.5} aria-hidden="true" /></button>
                    </div>
                  </div>
                </> : <div className={styles.querySkeleton} aria-hidden="true" />}
              </div>
              <div className={styles.navigationHeading}><h2>常用工作</h2></div>
              <div className={styles.navigation}>
                {canStartMap ? <HomeIntentLink
                  href={MAP_WORKSPACE.href}
                  mayPrefetch={Boolean(activeSession) && canAccessModule(MAP_WORKSPACE.module, activeRole)}
                  onClick={activeSession ? (event) => handleWorkspaceActivation(event, MAP_WORKSPACE) : undefined}
                  className={styles.mapLink}
                  aria-label={MAP_WORKSPACE.title}
                  {...mapAccessibilityProps}
                >
                  <MapIcon size={32} strokeWidth={1.35} aria-hidden="true" />
                  <div className={styles.mapTitle}>
                    <h2 id="home-heading">{MAP_WORKSPACE.title}</h2>
                    <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                </HomeIntentLink> : <div className={styles.mapSkeleton} aria-hidden="true" />}
                <div className={styles.businessLinks}>
                  {activeSession ? visibleBusinessWorkspaces.map((workspace) => <WorkspaceCard key={workspace.href} workspace={workspace} role={activeRole} onActivate={handleWorkspaceActivation} />)
                    : [0, 1, 2, 3].map(item => <div key={item} className={styles.linkSkeleton} aria-hidden="true" />)}
                </div>
              </div>
            </div>
          </section>
          {activeSession ? <aside className={styles.activity} aria-label="团队动态">
            <h2 className={styles.activityHeading}>团队动态</h2>
            <DeferredHomeActivity
              key={activeSession.user.id}
              userId={activeSession.user.id}
              userEmail={activeSession.user.email ?? ''}
              userName={activeSession.displayName}
            />
          </aside> : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}

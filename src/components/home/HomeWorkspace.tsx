'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ClipboardList,
  CloudUpload,
  Database,
  Handshake,
  LogOut,
  Map,
  Settings,
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
  description: '查询楼宇、子市场与市场指标，进入租金、空置率、绿色认证和供应等核心市场数据。',
  icon: Map,
};

const BUSINESS_WORKSPACES: WorkspaceModule[] = [
  {
    href: '/update',
    module: 'update',
    title: '季度数据填报',
    description: '更新楼宇租金、空置率与季度市场数据。',
    icon: ClipboardList,
  },
  {
    href: '/lease-submission',
    module: 'lease-submission',
    title: '租赁成交填报',
    description: '录入市场成交信息并执行重复与质量检查。',
    icon: Handshake,
  },
  {
    href: '/oss',
    module: 'oss',
    title: '研究资料库',
    description: '集中查找市场报告、研究文件与团队资料。',
    icon: CloudUpload,
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
  if (role === 'super_admin') return '超级管理员';
  return '内部用户';
}

function HomeHeader({ displayName, role, email, onLogout }: { displayName: string; role: string; email?: string; onLogout: () => void }) {
  const isRestrictedAdmin = email === 'judy.li@colliers.com';
  const isAdmin = isUserAdmin(role) && !isRestrictedAdmin;
  const roleLabel = getRoleLabel(role, isAdmin);

  return (
    <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-8 w-[58px] shrink-0 overflow-hidden rounded-[var(--cd-radius-sm)] bg-[#23488f]">
          <Image src={COLLIERS_LOGO_DATA_URI} alt="Colliers 高力国际" width={592} height={337} priority className="absolute left-1/2 top-1/2 h-[34px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2" />
        </div>
        <span className="h-5 w-px bg-[var(--cd-color-border)]" aria-hidden="true" />
        <div className="truncate text-sm font-semibold text-[var(--cd-color-text-primary)]">北京办公楼市场数据平台</div>
      </div>
      <nav className="flex shrink-0 items-center gap-1" aria-label="用户导航">
        <div className="mr-2 hidden min-w-0 items-center gap-2 lg:flex">
          <span className="max-w-52 truncate text-[13px] text-[var(--cd-color-text-secondary)]" title={displayName}>{displayName}</span>
          <span className="shrink-0 text-xs text-[var(--cd-color-text-muted)]">{roleLabel}</span>
        </div>
        <Link href="/settings" className="inline-flex h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] px-2.5 text-[13px] font-medium text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"><Settings size={15} strokeWidth={1.6} aria-hidden="true" /><span className="hidden sm:inline">设置</span></Link>
        <button type="button" onClick={onLogout} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] px-2.5 text-[13px] font-medium text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"><LogOut size={15} strokeWidth={1.6} aria-hidden="true" /><span className="hidden sm:inline">退出登录</span></button>
      </nav>
    </div>
  );
}

function WorkspaceCard({ workspace, role, onActivate, onKeyDown }: { workspace: WorkspaceModule; role: string; onActivate: (event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) => void; onKeyDown: (event: React.KeyboardEvent<HTMLAnchorElement>, workspace: WorkspaceModule) => void }) {
  const Icon = workspace.icon;
  const canAccess = canAccessModule(workspace.module, role);
  const isUnderDevelopment = UNDER_DEVELOPMENT_MODULES.some(({ module }) => module === workspace.module);
  const accessibilityProps = getAccessibilityProps(workspace.module, workspace.title, role);

  return (
    <Link href={workspace.href} onClick={(event) => onActivate(event, workspace)} onKeyDown={(event) => onKeyDown(event, workspace)} className={`group flex min-h-[104px] items-center gap-4 border-b border-[var(--cd-color-border)] px-1 py-4 transition-colors first:border-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:px-2 ${canAccess ? 'hover:bg-[var(--cd-color-surface-alt)]' : 'cursor-not-allowed opacity-55'}`} {...accessibilityProps}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]"><Icon size={18} strokeWidth={1.6} aria-hidden="true" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">{workspace.title}</h3>
          {isUnderDevelopment ? <Badge tone="warning">开发中</Badge> : null}
        </div>
        <p className="mt-1 text-[13px] leading-5 text-[var(--cd-color-text-secondary)]">{workspace.description}</p>
      </div>
      <ArrowRight size={16} strokeWidth={1.6} className="shrink-0 text-[var(--cd-color-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--cd-color-brand)]" aria-hidden="true" />
    </Link>
  );
}

function HomeLoadingShell() {
  return (
    <WorkspaceShell className="h-screen h-[100dvh] overflow-hidden" header={<div className="mx-auto flex h-14 w-full max-w-[1240px] items-center justify-between px-4 sm:px-6 lg:px-8"><div className="h-5 w-48 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" /><div className="h-7 w-28 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" /></div>}>
      <div className="h-full overflow-hidden p-4 sm:p-6 lg:p-8">
        <div className="mx-auto grid h-full max-w-[1240px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5"><div className="h-12 w-72 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-border)]" /><div className="h-36 animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)]" /><div className="space-y-1">{[0,1,2,3].map((item) => <div key={item} className="h-24 animate-pulse border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]" />)}</div></div>
          <div className="hidden animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)] lg:block" />
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

  const userLabel = React.useMemo(() => !ctx ? '' : ctx.role === 'admin' ? `${ctx.displayName} · 管理员` : ctx.displayName, [ctx]);
  if (status === 'loading' || !ctx) return <HomeLoadingShell />;

  const activeSession = ctx;
  const isRestrictedAdmin = activeSession.user.email === 'judy.li@colliers.com';
  const isAdmin = isUserAdmin(activeSession.role) && !isRestrictedAdmin;
  const canSeeAdminWorkspace = isAdmin || isDemoMode(activeSession.user.email);
  const businessWorkspaces = canSeeAdminWorkspace ? [...BUSINESS_WORKSPACES, ADMIN_WORKSPACE] : BUSINESS_WORKSPACES;

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

  function handleWorkspaceActivation(event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) { evaluateWorkspace(event, workspace); }
  function handleWorkspaceKeyDown(event: React.KeyboardEvent<HTMLAnchorElement>, workspace: WorkspaceModule) { if (event.key === 'Enter') evaluateWorkspace(event, workspace); }
  const MapIcon = MAP_WORKSPACE.icon;

  return (
    <>
      <WorkspaceShell className="h-screen h-[100dvh] overflow-hidden" header={<HomeHeader displayName={userLabel} role={activeSession.role} email={activeSession.user.email} onLogout={() => void handleLogout()} />}>
        <div className="h-full overflow-y-auto overscroll-contain">
          <div className="mx-auto grid min-h-full w-full max-w-[1240px] grid-cols-1 gap-8 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-10">
            <section className="min-w-0" aria-labelledby="home-heading">
              <div className="mb-5">
                <h1 id="home-heading" className="text-[22px] font-semibold leading-tight text-[var(--cd-color-text-primary)] sm:text-2xl">北京办公楼市场数据平台</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--cd-color-text-secondary)]">进入市场地图，或继续完成数据填报、研究资料与系统管理工作。</p>
              </div>

              <Link href={MAP_WORKSPACE.href} onClick={(event) => handleWorkspaceActivation(event, MAP_WORKSPACE)} onKeyDown={(event) => handleWorkspaceKeyDown(event, MAP_WORKSPACE)} className="group flex min-h-[132px] items-center gap-4 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border-strong)] bg-[var(--cd-color-surface)] p-5 transition-[border-color,background-color] hover:border-[var(--cd-color-brand)] hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:gap-5 sm:p-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] text-white"><MapIcon size={21} strokeWidth={1.6} aria-hidden="true" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-[var(--cd-color-text-primary)] sm:text-[17px]">{MAP_WORKSPACE.title}</h2>
                  <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-[var(--cd-color-text-secondary)] sm:text-sm sm:leading-6">{MAP_WORKSPACE.description}</p>
                </div>
                <div className="hidden shrink-0 items-center gap-1.5 text-[13px] font-semibold text-[var(--cd-color-brand)] sm:flex">进入地图<ArrowRight size={16} strokeWidth={1.7} aria-hidden="true" /></div>
                <ArrowRight size={17} strokeWidth={1.7} className="shrink-0 text-[var(--cd-color-brand)] sm:hidden" aria-hidden="true" />
              </Link>

              <div className="mb-1 mt-7 flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">工作区</h2>
                <span className="text-xs text-[var(--cd-color-text-muted)]">按业务进入</span>
              </div>
              <div>{businessWorkspaces.map((workspace) => <WorkspaceCard key={workspace.href} workspace={workspace} role={activeSession.role} onActivate={handleWorkspaceActivation} onKeyDown={handleWorkspaceKeyDown} />)}</div>
            </section>

            <aside className="min-w-0 border-t border-[var(--cd-color-border)] pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0 xl:pl-8" aria-label="通知与动态">
              <div className="mb-3 flex items-baseline justify-between gap-3"><h2 className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">通知与动态</h2><span className="text-xs text-[var(--cd-color-text-muted)]">辅助信息</span></div>
              <div className="min-h-[240px] overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">{showCommunication && activeSession.user.email ? <CommunicationBoard userEmail={activeSession.user.email} userName={activeSession.displayName} /> : <div className="h-[260px] animate-pulse bg-[var(--cd-color-surface-alt)]" aria-hidden="true" />}</div>
              <div className="mt-4">{showCommunication ? <NoticeBanner /> : <div className="h-10 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)]" />}</div>
            </aside>
          </div>
        </div>
      </WorkspaceShell>
      <UnderDevelopmentModal isOpen={showDevModal} onClose={() => { setShowDevModal(false); setClickedModule(''); }} moduleName={clickedModule} />
    </>
  );
}

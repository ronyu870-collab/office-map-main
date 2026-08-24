'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  ClipboardList,
  CloudUpload,
  Database,
  Handshake,
  LogOut,
  Map,
  Settings,
  ShieldCheck,
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
  eyebrow: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

const MAP_WORKSPACE: WorkspaceModule = {
  href: '/map', module: 'map', title: '北京办公楼市场地图', eyebrow: 'MAP WORKBENCH',
  description: '从楼宇、子市场和市场指标进入北京办公楼数据，支持租金、空置率、LEED 与供应等多维分析。', icon: Map,
};

const BUSINESS_WORKSPACES: WorkspaceModule[] = [
  { href: '/update', module: 'update', title: '季度数据填报', eyebrow: 'QUARTERLY UPDATE', description: '更新楼宇租金、空置率与季度市场数据。', icon: ClipboardList },
  { href: '/lease-submission', module: 'lease-submission', title: '租赁成交填报', eyebrow: 'LEASE SUBMISSION', description: '录入市场成交信息并执行重复与质量检查。', icon: Handshake },
  { href: '/oss', module: 'oss', title: 'Research Library', eyebrow: 'RESEARCH LIBRARY', description: '集中访问市场报告、研究文件与团队资料。', icon: CloudUpload },
];

const ADMIN_WORKSPACE: WorkspaceModule = {
  href: '/admin', module: 'admin', title: 'Administration', eyebrow: 'ADMIN CONSOLE',
  description: '管理数据库、用户、审计记录与系统配置。', icon: Database,
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

function HomeHeader({ displayName, role, email, onLogout }: { displayName: string; role: string; email?: string; onLogout: () => void }) {
  const isRestrictedAdmin = email === 'judy.li@colliers.com';
  const isAdmin = isUserAdmin(role) && !isRestrictedAdmin;
  return (
    <div className="mx-auto flex h-14 w-full max-w-[1480px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-8 w-[58px] shrink-0 overflow-hidden rounded-[var(--cd-radius-sm)] bg-[#23488f]">
          <Image src={COLLIERS_LOGO_DATA_URI} alt="Colliers 高力国际" width={592} height={337} priority className="absolute left-1/2 top-1/2 h-[34px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2" />
        </div>
        <span className="h-5 w-px bg-[var(--cd-color-border)]" aria-hidden="true" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-[0.02em] text-[var(--cd-color-text-primary)]" translate="no">COLLIERS DATA</div>
          <div className="hidden truncate text-[11px] text-[var(--cd-color-text-muted)] sm:block">北京办公楼市场数据平台</div>
        </div>
      </div>
      <nav className="flex shrink-0 items-center gap-1" aria-label="用户导航">
        <div className="mr-2 hidden items-center gap-2 lg:flex">
          <span className="max-w-48 truncate text-xs text-[var(--cd-color-text-secondary)]" title={displayName}>{displayName}</span>
          <Badge tone={isAdmin ? 'brand' : 'neutral'}>{isAdmin ? 'Admin' : role}</Badge>
        </div>
        <Link href="/settings" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--cd-radius-md)] px-2.5 text-xs font-medium text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"><Settings size={14} strokeWidth={1.6} aria-hidden="true" /><span className="hidden sm:inline">设置</span></Link>
        <button type="button" onClick={onLogout} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--cd-radius-md)] px-2.5 text-xs font-medium text-[var(--cd-color-text-secondary)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"><LogOut size={14} strokeWidth={1.6} aria-hidden="true" /><span className="hidden sm:inline">退出</span></button>
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
    <Link href={workspace.href} onClick={(event) => onActivate(event, workspace)} onKeyDown={(event) => onKeyDown(event, workspace)} className={`group relative flex min-h-[92px] items-start gap-3 rounded-[var(--cd-radius-lg)] border p-4 transition-[border-color,background-color] duration-[var(--cd-motion-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${canAccess ? 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] hover:border-[var(--cd-color-border-strong)] hover:bg-[var(--cd-color-surface-alt)]' : 'cursor-not-allowed border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] opacity-60'}`} {...accessibilityProps}>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-[var(--cd-color-brand)]"><Icon size={16} strokeWidth={1.6} aria-hidden="true" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--cd-color-text-muted)]">{workspace.eyebrow}</span>{isUnderDevelopment ? <Badge tone="warning">开发中</Badge> : null}</div>
        <h3 className="mt-1 text-sm font-semibold text-[var(--cd-color-text-primary)]">{workspace.title}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--cd-color-text-secondary)]">{workspace.description}</p>
      </div>
      <ArrowRight size={14} strokeWidth={1.6} className="mt-1 shrink-0 text-[var(--cd-color-text-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

function HomeLoadingShell() {
  return (
    <WorkspaceShell className="h-screen h-[100dvh] overflow-hidden" header={<div className="mx-auto flex h-14 w-full max-w-[1480px] items-center justify-between px-4 sm:px-6 lg:px-8"><div className="h-5 w-36 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" /><div className="h-7 w-28 animate-pulse rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-border)]" /></div>}>
      <div className="h-full overflow-hidden p-4 sm:p-6 lg:p-8"><div className="mx-auto grid h-full max-w-[1480px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="space-y-4"><div className="h-14 w-72 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-border)]" /><div className="h-44 animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)]" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0,1,2,3].map((item) => <div key={item} className="h-24 animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)]" />)}</div></div><div className="hidden animate-pulse rounded-[var(--cd-radius-lg)] bg-[var(--cd-color-border)] xl:block" /></div></div>
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

  const isRestrictedAdmin = ctx.user.email === 'judy.li@colliers.com';
  const isAdmin = isUserAdmin(ctx.role) && !isRestrictedAdmin;
  const canSeeAdminWorkspace = isAdmin || isDemoMode(ctx.user.email);
  const businessWorkspaces = canSeeAdminWorkspace ? [...BUSINESS_WORKSPACES, ADMIN_WORKSPACE] : BUSINESS_WORKSPACES;

  async function handleLogout() {
    try {
      if (ctx.user.email) await logActionImmediate(ctx.user.email, 'LOGOUT', { platform: 'web' });
      await signOut(); window.location.href = '/login';
    } catch { window.location.href = '/login'; }
  }

  function evaluateWorkspace(event: { preventDefault: () => void }, workspace: WorkspaceModule) {
    const restricted = isModuleRestricted(workspace.module);
    const admin = isUserAdmin(ctx.role);
    const canAccess = canAccessModule(workspace.module, ctx.role);
    if (ctx.user.email) {
      const details: Record<string, unknown> = { module: workspace.module, blocked: !canAccess };
      if (restricted && !admin) details.reason = 'restricted_module';
      logAction(ctx.user.email, 'ENTER_MODULE', details);
    }
    if (!canAccess) { event.preventDefault(); return; }
    const underDevelopment = UNDER_DEVELOPMENT_MODULES.some(({ module }) => module === workspace.module);
    if (underDevelopment && !admin) { event.preventDefault(); setClickedModule(workspace.title); setShowDevModal(true); }
  }

  function handleWorkspaceActivation(event: React.MouseEvent<HTMLAnchorElement>, workspace: WorkspaceModule) { evaluateWorkspace(event, workspace); }
  function handleWorkspaceKeyDown(event: React.KeyboardEvent<HTMLAnchorElement>, workspace: WorkspaceModule) { if (event.key === 'Enter') evaluateWorkspace(event, workspace); }
  const MapIcon = MAP_WORKSPACE.icon;

  return (
    <>
      <WorkspaceShell className="h-screen h-[100dvh] overflow-hidden" header={<HomeHeader displayName={userLabel} role={ctx.role} email={ctx.user.email} onLogout={() => void handleLogout()} />}>
        <div className="h-full overflow-y-auto overscroll-contain">
          <div className="mx-auto grid min-h-full w-full max-w-[1480px] grid-cols-1 gap-5 p-4 sm:p-6 lg:p-8 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0" aria-labelledby="home-heading">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--cd-color-text-muted)]"><Building2 size={13} strokeWidth={1.6} aria-hidden="true" />COLLIERS DATA WORKSPACE</div><h1 id="home-heading" className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--cd-color-text-primary)] sm:text-2xl">北京办公楼市场数据平台</h1><p className="mt-1 text-sm text-[var(--cd-color-text-secondary)]">从地图进入市场，从工作区完成数据维护与团队协作。</p></div><Badge tone="brand">Internal · Beijing</Badge></div>
              <Link href={MAP_WORKSPACE.href} onClick={(event) => handleWorkspaceActivation(event, MAP_WORKSPACE)} onKeyDown={(event) => handleWorkspaceKeyDown(event, MAP_WORKSPACE)} className="group relative block overflow-hidden rounded-[var(--cd-radius-lg)] border border-[color:rgb(0_62_126_/_0.22)] bg-[var(--cd-color-surface)] p-5 shadow-[var(--cd-shadow-sm)] transition-[border-color,box-shadow] hover:border-[var(--cd-color-brand)] hover:shadow-[var(--cd-shadow-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] sm:p-6">
                <div className="absolute inset-y-0 left-0 w-1 bg-[var(--cd-color-brand)]" aria-hidden="true" />
                <div className="flex items-start justify-between gap-5"><div className="min-w-0"><div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--cd-color-brand)]"><MapIcon size={14} strokeWidth={1.7} aria-hidden="true" />{MAP_WORKSPACE.eyebrow}</div><h2 className="mt-2 text-lg font-semibold text-[var(--cd-color-text-primary)] sm:text-xl">{MAP_WORKSPACE.title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--cd-color-text-secondary)]">{MAP_WORKSPACE.description}</p><div className="mt-4 flex flex-wrap gap-2" aria-label="地图主要维度">{['Rent','Vacancy','LEED','Supply'].map((label) => <Badge key={label}>{label}</Badge>)}</div></div><div className="flex h-9 shrink-0 items-center gap-2 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3 text-xs font-medium text-white transition-colors group-hover:bg-[var(--cd-color-brand-hover)]">Open<ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" /></div></div>
              </Link>
              <div className="mb-3 mt-6"><h2 className="text-sm font-semibold text-[var(--cd-color-text-primary)]">Business workspaces</h2><p className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">数据维护、成交填报、研究资料与系统管理</p></div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{businessWorkspaces.map((workspace) => <WorkspaceCard key={workspace.href} workspace={workspace} role={ctx.role} onActivate={handleWorkspaceActivation} onKeyDown={handleWorkspaceKeyDown} />)}</div>
            </section>
            <aside className="min-w-0 xl:border-l xl:border-[var(--cd-color-border)] xl:pl-5" aria-label="团队协作与系统信息">
              <div className="mb-3"><h2 className="text-sm font-semibold text-[var(--cd-color-text-primary)]">Team activity</h2><p className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">低优先级协作信息，不阻塞核心工作区</p></div>
              <div className="min-h-[220px] overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">{showCommunication && ctx.user.email ? <CommunicationBoard userEmail={ctx.user.email} userName={ctx.displayName} /> : <div className="h-[260px] animate-pulse bg-[var(--cd-color-surface-alt)]" aria-hidden="true" />}</div>
              <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--cd-color-text-secondary)]"><ShieldCheck size={14} strokeWidth={1.6} aria-hidden="true" />System notice</div><div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">{showCommunication ? <NoticeBanner /> : <div className="h-11 animate-pulse bg-[var(--cd-color-surface-alt)]" />}</div></div>
            </aside>
          </div>
        </div>
      </WorkspaceShell>
      <UnderDevelopmentModal isOpen={showDevModal} onClose={() => { setShowDevModal(false); setClickedModule(''); }} moduleName={clickedModule} />
    </>
  );
}

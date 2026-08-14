'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Map, CloudUpload, ClipboardList,
  Settings, LogOut, ShieldCheck, ArrowRight, Handshake
} from 'lucide-react';

import { CommunicationBoard } from '@/src/components/CommunicationBoard';
import { NoticeBanner } from '@/src/components/NoticeBanner';
import { getSessionFast, signOut } from '@/src/services/Auth';
import { logAction, logActionImmediate } from '@/src/utils/audit';
import { perfStart, perfEnd, perfMark, perfReport } from '@/src/utils/performanceLogger';
import {
  isModuleRestricted,
  isUserAdmin,
  canAccessModule,
  getModuleStyles,
  getAccessibilityProps
} from '@/src/utils/accessControl';
import { isDemoMode } from '@/src/config/demoMode';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';

/**
 * 开发中模块配置
 * 
 * 用途：标记尚未完成开发的功能模块
 * 
 * 行为：
 * - 管理员（admin）可以正常访问这些模块进行测试
 * - 非管理员（viewer/editor）点击时会看到"功能开发中"提示
 * 
 * 维护：
 * - 添加新的开发中模块：在数组中添加 { module, href } 对象
 * - 功能完成后：从数组中移除对应项即可恢复正常访问
 * 
 * 注意：module 字段必须与 NAV_MODULES 中的 module 字段匹配
 */
type UnderDevelopmentModule = {
  module: string;  // 模块标识符，如 'bi', 'deals'
  href: string;    // 路由路径，如 '/bi', '/deals'
};

const UNDER_DEVELOPMENT_MODULES: UnderDevelopmentModule[] = [];

interface UnderDevelopmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  moduleName: string;
}

function UnderDevelopmentModal({ isOpen, onClose, moduleName }: UnderDevelopmentModalProps) {
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  // ESC 键关闭
  React.useEffect(() => {
    if (!isOpen) return;
    
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // 焦点管理
  React.useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/50 p-4">
      <div 
        role="dialog" 
        aria-modal="true"
        aria-labelledby="modal-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200/60 bg-white p-6 shadow-modal"
      >
        <h3 id="modal-title" className="text-lg font-semibold text-zinc-900">功能开发中</h3>
        
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          {moduleName} 功能正在紧张开发中，敬请期待。
          我们会尽快完成并通知您。
        </p>
        
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-[background-color,box-shadow] hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}

interface ModuleBadgeProps {
  isAdmin: boolean;
}

function ModuleBadge({ isAdmin }: ModuleBadgeProps) {
  return (
    <span className="absolute right-2 top-2 rounded-sm border border-zinc-200 bg-zinc-100 px-2 py-1 text-[10px] font-semibold text-zinc-600">
      开发中{isAdmin && ' · 管理员可访问'}
    </span>
  );
}

/**
 * 导航模块配置类型
 */
type NavModule = {
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  subtitle: string;
  desc1: string;
  desc2: string;
  module: string;
  primary: boolean;
  restrictedTo?: string[]; // 可选：限制访问的角色列表
};

const NAV_MODULES: NavModule[] = [
  {
    href: '/map',
    icon: Map,
    title: '核心地图系统',
    subtitle: 'Interactive Map',
    desc1: '实时楼宇分布与市场热力图',
    desc2: '支持租金、空置率、LEED 多维渲染',
    module: 'map',
    primary: true,
  },
  {
    href: '/update',
    icon: ClipboardList,
    title: '季度数据填报',
    subtitle: 'Quarterly Update',
    desc1: '录入本季度租金与空置率数据',
    desc2: '草稿自动云端同步，支持多分类',
    module: 'update',
    primary: false,
  },
  {
    href: '/oss',
    icon: CloudUpload,
    title: '云端资料库',
    subtitle: 'OSS File Manager',
    desc1: '上传与管理市场报告及研究文件',
    desc2: '阿里云 OSS 驱动，安全可靠',
    module: 'oss',
    primary: false,
  },
  {
    href: '/lease-submission',
    icon: Handshake,
    title: '租赁成交填报',
    subtitle: 'Lease Submission',
    desc1: '记录市场成交信息，追踪填报进度',
    desc2: '每周任务目标，数据质量保障',
    module: 'lease-submission',
    primary: false,
  },
];

export default function LobbyPage() {
  const router = useRouter();
  const [ctx, setCtx] = React.useState<Awaited<ReturnType<typeof getSessionFast>>>(null);
  const [showDevModal, setShowDevModal] = React.useState(false);
  const [clickedModule, setClickedModule] = React.useState<string>('');
  
  // 延迟加载非关键组件
  const [showCommunication, setShowCommunication] = React.useState(false);

  React.useEffect(() => {
    perfStart('主页-总加载时间');
    perfStart('主页-身份验证');
    
    // 渐进式渲染：先显示骨架屏，异步加载数据
    
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSessionFast(); // 使用快速获取方法
        perfEnd('主页-身份验证');
        
        if (cancelled) return;
        if (!session) { router.replace('/login'); return; }
        
        perfStart('主页-设置状态');
        setCtx(session);
        perfEnd('主页-设置状态');
        
        perfMark('主页-核心UI已渲染');
        
        // 非关键区域使用低优先级更新，但不再人为增加固定等待。
        perfStart('主页-加载沟通组件');
        React.startTransition(() => {
          if (!cancelled) {
            setShowCommunication(true);
          }
        });
        perfEnd('主页-加载沟通组件');
        perfEnd('主页-总加载时间');

        // 性能报告仍延后生成，避免占用首屏渲染时间。
        setTimeout(() => perfReport(), 1000);
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const userLabel = React.useMemo(() => {
    if (!ctx) return '';
    const base = ctx.displayName;
    return ctx.role === 'admin' ? `${base} · 管理员` : base;
  }, [ctx]);

  async function handleLogout() {
    try {
      if (ctx?.user?.email) await logActionImmediate(ctx.user.email, 'LOGOUT', { platform: 'web' });
      await signOut();
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  }

  function handleModuleClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    module: { href: string; module: string; title: string }
  ) {
    // 1. 检查是否为受限模块（优先级最高）
    const isRestricted = isModuleRestricted(module.module);
    const userRole = ctx?.role;
    const isAdmin = isUserAdmin(userRole);
    const canAccess = canAccessModule(module.module, userRole);
    
    // 2. 记录审计日志（包含 blocked 和 reason 字段）
    if (ctx?.user?.email) {
      const logDetails: Record<string, unknown> = {
        module: module.module,
        blocked: !canAccess
      };
      
      // 如果是受限模块且用户非管理员，添加 reason 字段
      if (isRestricted && !isAdmin) {
        logDetails.reason = 'restricted_module';
      }
      
      logAction(ctx.user.email, 'ENTER_MODULE', logDetails);
    }
    
    // 3. 如果是受限模块且用户无权访问，阻止导航
    if (!canAccess) {
      e.preventDefault();
      // 受限模块不显示开发中提示，直接阻止
      return;
    }
    
    // 4. 检查是否为开发中模块（优先级低于受限模块检查）
    const isUnderDev = UNDER_DEVELOPMENT_MODULES.some(m => m.module === module.module);
    
    if (isUnderDev && !isAdmin) {
      e.preventDefault(); // 阻止导航
      setClickedModule(module.title);
      setShowDevModal(true);
      return;
    }
    
    // 5. 允许导航（管理员访问开发中模块，或普通用户访问非受限非开发中模块）
  }

  /**
   * 处理模块键盘导航事件
   * 
   * 功能：确保键盘导航（Enter 键）与鼠标点击行为完全一致
   * - 受限模块检查
   * - 权限验证
   * - 审计日志记录
   * - 导航控制
   */
  function handleModuleKeyDown(
    e: React.KeyboardEvent<HTMLAnchorElement>,
    module: { href: string; module: string; title: string }
  ) {
    // 只处理 Enter 键
    if (e.key !== 'Enter') return;
    
    // 1. 检查是否为受限模块（优先级最高）
    const isRestricted = isModuleRestricted(module.module);
    const userRole = ctx?.role;
    const isAdmin = isUserAdmin(userRole);
    const canAccess = canAccessModule(module.module, userRole);
    
    // 2. 记录审计日志（包含 blocked 和 reason 字段）
    if (ctx?.user?.email) {
      const logDetails: Record<string, unknown> = {
        module: module.module,
        blocked: !canAccess
      };
      
      // 如果是受限模块且用户非管理员，添加 reason 字段
      if (isRestricted && !isAdmin) {
        logDetails.reason = 'restricted_module';
      }
      
      logAction(ctx.user.email, 'ENTER_MODULE', logDetails);
    }
    
    // 3. 如果是受限模块且用户无权访问，阻止导航
    if (!canAccess) {
      e.preventDefault();
      // 受限模块不显示开发中提示，直接阻止
      return;
    }
    
    // 4. 检查是否为开发中模块（优先级低于受限模块检查）
    const isUnderDev = UNDER_DEVELOPMENT_MODULES.some(m => m.module === module.module);
    
    if (isUnderDev && !isAdmin) {
      e.preventDefault(); // 阻止导航
      setClickedModule(module.title);
      setShowDevModal(true);
      return;
    }
    
    // 5. 允许导航（管理员访问开发中模块，或普通用户访问非受限非开发中模块）
  }

  function handleCloseModal() {
    setShowDevModal(false);
    setClickedModule('');
  }

  // ✅ 性能优化：渐进式渲染 - 立即显示页面框架，异步加载用户信息
  const isLoadingUser = !ctx;
  const isRestrictedAdmin = ctx?.user?.email === 'judy.li@colliers.com';
  const isAdmin = ctx?.role?.trim().toLowerCase() === 'admin' && !isRestrictedAdmin;
  const userRole = ctx?.role?.trim().toLowerCase() || '';
  
  const [primaryModule, ...allSecondaryModules] = NAV_MODULES;
  
  // 过滤次级模块：如果模块有 restrictedTo，则只对指定角色显示
  const secondaryModules = allSecondaryModules.filter((mod) => {
    if (!mod.restrictedTo || mod.restrictedTo.length === 0) return true;
    return mod.restrictedTo.includes(userRole);
  });

  return (
    <div className="flex h-screen h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#f4f6f9] text-zinc-900">
      {/* ── Header ── */}
      <header className="border-b border-[#002f61] bg-primary">
        <div className="mx-auto flex min-h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative h-8 w-[58px] shrink-0 overflow-hidden rounded-sm bg-[#23488f]">
              <Image
                src={COLLIERS_LOGO_DATA_URI}
                alt="Colliers 高力国际"
                width={592}
                height={337}
                priority
                className="absolute left-1/2 top-1/2 h-[34px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2"
              />
            </div>
            <span className="h-4 w-px bg-white/25" aria-hidden="true" />
            <div className="min-w-0">
              <span className="block truncate text-sm font-bold tracking-tight text-white" translate="no">COLLIERS DATA</span>
              <span className="hidden text-[10px] font-medium tracking-wide text-white/55 sm:block">内部数据平台</span>
            </div>
          </div>
          <nav className="flex shrink-0 items-center gap-0.5 text-xs" aria-label="用户导航">
            {isLoadingUser ? (
              <div className="h-4 w-28 animate-pulse rounded-sm bg-white/20" aria-hidden="true" />
            ) : (
              <>
                <span 
                  className="mr-2 hidden max-w-[180px] truncate text-white/70 md:inline"
                  title={userLabel}
                >
                  {userLabel}
                </span>
                {(isAdmin || isDemoMode(ctx?.user?.email)) && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-white/80 transition-[background-color,color] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    aria-label="管理后台"
                  >
                    <ShieldCheck size={14} strokeWidth={1.5} aria-hidden="true" />
                    <span className="hidden sm:inline">管理后台</span>
                  </Link>
                )}
                <Link 
                  href="/settings" 
                  className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-white/80 transition-[background-color,color] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Settings size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span className="hidden sm:inline">设置</span>
                </Link>
                <button 
                  onClick={handleLogout} 
                  className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-white/80 transition-[background-color,color] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <LogOut size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span className="hidden sm:inline">退出</span>
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-5 sm:px-6 sm:py-6 lg:px-8" aria-labelledby="home-heading">
        {isLoadingUser ? (
          // ✅ 骨架屏：显示页面结构，而非空白或全屏加载器
          <>
            <div className="mb-4 h-7 w-44 animate-pulse rounded-sm bg-zinc-200" aria-hidden="true" />
            <div className="mb-4 h-[92px] animate-pulse rounded-xl bg-zinc-200" aria-hidden="true" />
            <div className="mb-5 grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-200" aria-hidden="true" />
              ))}
            </div>
            <div className="min-h-0 flex-1 animate-pulse rounded-xl bg-zinc-200" aria-hidden="true" />
          </>
        ) : (
          // ✅ 实际内容
          <>
            {/* ── 欢迎语 ── */}
            <div className="mb-4">
              <h1 id="home-heading" className="truncate text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl">
                欢迎回来，{ctx?.displayName}
              </h1>
            </div>

            {/* ── 主入口（地图）── */}
            <Link
              href={primaryModule.href}
              onClick={() => ctx?.user?.email && logAction(ctx.user.email, 'ENTER_MODULE', { module: primaryModule.module })}
              className="group mb-4 flex min-h-[92px] items-center justify-between rounded-xl border border-[#003e7e] bg-primary px-5 py-4 shadow-sm transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-[#064b8f] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/35 focus-visible:ring-offset-2"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                  <primaryModule.icon size={18} strokeWidth={1.5} className="text-white" aria-hidden="true" />
                </div>
                <span className="text-sm font-semibold tracking-tight text-white">
                  {primaryModule.title}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[12px] font-medium text-white/70 transition-colors group-hover:text-white">
                立即进入 <ArrowRight size={13} strokeWidth={1.5} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </div>
            </Link>

            {/* ── 次级模块：2x2 网格 ── */}
            <div className="mb-5 grid grid-cols-2 gap-3">
              {secondaryModules.map((mod) => {
                const isUnderDev = UNDER_DEVELOPMENT_MODULES.some(m => m.module === mod.module);
                
                // 获取动态样式和可访问性属性
                const styles = getModuleStyles(mod.module, ctx?.role);
                const a11yProps = getAccessibilityProps(mod.module, mod.title, ctx?.role);
                
                return (
                  <Link
                    key={mod.href}
                    href={mod.href}
                    onClick={(e) => handleModuleClick(e, mod)}
                    onKeyDown={(e) => handleModuleKeyDown(e, mod)}
                    className={`${styles.cardClass} ${secondaryModules.length === 1 ? 'col-span-2' : ''} min-h-16 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/25 focus-visible:ring-offset-2`}
                    {...a11yProps}
                  >
                    {/* 徽章 */}
                    {isUnderDev && <ModuleBadge isAdmin={isAdmin} />}
                    
                    {/* 原有内容 */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200/70 bg-zinc-50 transition-[background-color,border-color] group-hover:border-primary/20 group-hover:bg-primary/5">
                        <mod.icon size={15} strokeWidth={1.5} className={styles.iconClass} aria-hidden="true" />
                      </div>
                      <span className={`${styles.textClass} min-w-0 truncate`}>{mod.title}</span>
                    </div>
                    <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 text-zinc-400 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>

            {/* ── 底部区域：沟通看板和公告 ── */}
            <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" aria-label="协作看板和系统公告">
              {/* ── 沟通看板 ── */}
              {showCommunication && ctx?.user?.email && (
                <div className="min-h-0 flex-1 overflow-hidden">
                  <CommunicationBoard
                    userEmail={ctx.user.email}
                    userName={ctx.displayName}
                  />
                </div>
              )}
              {!showCommunication && (
                <div className="min-h-0 flex-1 animate-pulse rounded-xl border border-zinc-200/70 bg-white" aria-hidden="true" />
              )}

              {/* ── 系统公告 ── */}
              {showCommunication && (
                <div className="shrink-0">
                  <NoticeBanner />
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* ── 开发中提示模态框 ── */}
      <UnderDevelopmentModal
        isOpen={showDevModal}
        onClose={handleCloseModal}
        moduleName={clickedModule}
      />
    </div>
  );
}

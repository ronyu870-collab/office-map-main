from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def must_replace(text: str, old: str, new: str, label: str, count: int = 1) -> str:
    if old not in text:
        raise RuntimeError(f'missing patch anchor: {label}')
    return text.replace(old, new, count)


write('src/config/accessControl.ts', """import type { UserRole } from '@/src/types/auth';

/** 已认证用户之间的模块角色授权。未认证/未知角色由 policy helper fail closed。 */
export type RestrictedModule = {
  module: string;
  href: string;
  allowedRoles: readonly UserRole[];
};

export const RESTRICTED_MODULES: readonly RestrictedModule[] = [
  { module: 'update', href: '/update', allowedRoles: ['editor', 'admin'] },
  { module: 'lease-submission', href: '/lease-submission', allowedRoles: ['editor', 'admin'] },
  { module: 'admin', href: '/admin', allowedRoles: ['admin'] },
];
""")

write('src/utils/accessControl.ts', """import { RESTRICTED_MODULES } from '@/src/config/accessControl';
import { parseUserRole } from '@/src/types/auth';

export const RESTRICTED_ADMIN_EMAILS = new Set(['judy.li@colliers.com']);

export type ModuleAccessReason =
  | 'invalid_role'
  | 'role_not_allowed'
  | 'restricted_admin'
  | 'impersonation_read_only';

export type ModuleAccessOptions = {
  email?: string | null;
  isImpersonating?: boolean;
};

export type ModuleAccessDecision = { allowed: boolean; reason?: ModuleAccessReason };

export function isModuleRestricted(moduleId: string): boolean {
  return RESTRICTED_MODULES.some(module => module.module === moduleId);
}

export function isUserAdmin(role: string | null | undefined): boolean {
  return parseUserRole(role) === 'admin';
}

export function isRestrictedAdminEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase() ?? '';
  return Boolean(normalized) && RESTRICTED_ADMIN_EMAILS.has(normalized);
}

export function isRestrictedAdminIdentity(params: { role: string | null | undefined; email?: string | null }): boolean {
  return isUserAdmin(params.role) && isRestrictedAdminEmail(params.email);
}

/** Single source of truth for module visibility, click blocking and client route guards. */
export function getModuleAccessDecision(
  moduleId: string,
  userRole: string | null | undefined,
  options: ModuleAccessOptions = {},
): ModuleAccessDecision {
  const role = parseUserRole(userRole);
  if (!role) return { allowed: false, reason: 'invalid_role' };

  if (moduleId === 'admin') {
    if (options.isImpersonating) return { allowed: false, reason: 'impersonation_read_only' };
    if (isRestrictedAdminIdentity({ role, email: options.email })) {
      return { allowed: false, reason: 'restricted_admin' };
    }
  }

  const restriction = RESTRICTED_MODULES.find(module => module.module === moduleId);
  if (restriction && !restriction.allowedRoles.includes(role)) {
    return { allowed: false, reason: 'role_not_allowed' };
  }
  return { allowed: true };
}

export function canAccessModule(
  moduleId: string,
  userRole: string | null | undefined,
  options: ModuleAccessOptions = {},
): boolean {
  return getModuleAccessDecision(moduleId, userRole, options).allowed;
}

export function getRoleLabel(role: string | null | undefined, email?: string | null): string {
  const parsed = parseUserRole(role);
  if (parsed === 'admin') return isRestrictedAdminEmail(email) ? '受限管理员' : '管理员';
  if (parsed === 'editor') return '编辑用户';
  if (parsed === 'viewer') return '查看用户';
  return '未知角色';
}

export type ModuleStyles = { cardClass: string; iconClass: string; textClass: string; cursorClass: string };

export function getModuleStyles(
  moduleId: string,
  userRole: string | null | undefined,
  options: ModuleAccessOptions = {},
): ModuleStyles {
  if (canAccessModule(moduleId, userRole, options)) {
    return {
      cardClass: 'group relative flex flex-1 items-center justify-between rounded-xl border border-zinc-200/60 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md',
      iconClass: 'text-zinc-500 transition group-hover:text-primary',
      textClass: 'text-[13px] font-semibold tracking-tight text-zinc-900 group-hover:text-primary',
      cursorClass: 'cursor-pointer',
    };
  }
  return {
    cardClass: 'relative flex flex-1 items-center justify-between rounded-xl border border-zinc-200/60 bg-zinc-100 px-4 py-3 shadow-sm cursor-not-allowed',
    iconClass: 'text-zinc-400 opacity-50',
    textClass: 'text-[13px] font-semibold tracking-tight text-zinc-400',
    cursorClass: 'cursor-not-allowed',
  };
}

export type AccessibilityProps = { 'aria-disabled'?: 'true'; 'aria-label'?: string; role?: string };

export function getAccessibilityProps(
  moduleId: string,
  moduleTitle: string,
  userRole: string | null | undefined,
  options: ModuleAccessOptions = {},
): AccessibilityProps {
  if (!canAccessModule(moduleId, userRole, options)) {
    return { 'aria-disabled': 'true', 'aria-label': `${moduleTitle} - 当前角色无权访问`, role: 'link' };
  }
  return { role: 'link' };
}
""")

write('src/utils/adminAccess.ts', """import {
  RESTRICTED_ADMIN_EMAILS,
  canAccessModule,
  isRestrictedAdminEmail,
  isUserAdmin,
} from '@/src/utils/accessControl';

export { RESTRICTED_ADMIN_EMAILS, isRestrictedAdminEmail };

export function isAdminRole(role: string | null | undefined): boolean {
  return isUserAdmin(role);
}

export function isResearchLibraryManager(role: string | null | undefined): boolean {
  return isUserAdmin(role);
}

/** Demo is presentation-only and never grants authorization. */
export function canAccessAdminConsole(params: {
  role: string | null | undefined;
  email?: string | null;
  isDemo?: boolean;
  isImpersonating?: boolean;
}): boolean {
  return canAccessModule('admin', params.role, {
    email: params.email,
    isImpersonating: params.isImpersonating,
  });
}
""")

# Home policy + logout UX.
p = 'src/components/home/HomeWorkspace.tsx'
t = read(p)
t = t.replace("import { isDemoMode } from '@/src/config/demoMode';\n", '')
t = t.replace("import { useAppSession } from '@/src/components/SessionProvider';", "import { useAppSession } from '@/src/components/SessionProvider';\nimport { useImpersonation } from '@/src/contexts/ImpersonationContext';")
t = t.replace("import { signOut } from '@/src/services/Auth';", "import { clearImpersonationCache, getSession, signOut } from '@/src/services/Auth';")
t = t.replace("  getAccessibilityProps,\n  isModuleRestricted,\n  isUserAdmin,", "  getAccessibilityProps,\n  getModuleAccessDecision,\n  getRoleLabel,\n  isUserAdmin,")
t = re.sub(r"\nfunction getRoleLabel\(role: string, isAdmin: boolean\) \{.*?\n\}\n", '\n', t, flags=re.S)
t = must_replace(t, "  canSeeAdminWorkspace,\n  onLogout,", "  canSeeAdminWorkspace,\n  isImpersonating,\n  isLoggingOut,\n  onLogout,", 'HomeHeader args')
t = must_replace(t, "  canSeeAdminWorkspace: boolean;\n  onLogout: () => void;", "  canSeeAdminWorkspace: boolean;\n  isImpersonating: boolean;\n  isLoggingOut: boolean;\n  onLogout: () => void;", 'HomeHeader types')
t = must_replace(t, """  const isRestrictedAdmin = email === 'judy.li@colliers.com';
  const isAdmin = isUserAdmin(role) && !isRestrictedAdmin;
  const roleLabel = getRoleLabel(role, isAdmin);
  const adminCanAccess = canAccessModule(ADMIN_WORKSPACE.module, role);
  const adminAccessibilityProps = getAccessibilityProps(ADMIN_WORKSPACE.module, ADMIN_WORKSPACE.title, role);""", """  const roleLabel = getRoleLabel(role, email);
  const adminDecision = getModuleAccessDecision(ADMIN_WORKSPACE.module, role, { email, isImpersonating });
  const adminCanAccess = adminDecision.allowed;
  const adminAccessibilityProps = getAccessibilityProps(ADMIN_WORKSPACE.module, ADMIN_WORKSPACE.title, role, { email, isImpersonating });""", 'HomeHeader decision')
t = must_replace(t, """                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}""", """                disabled={isLoggingOut}
                aria-busy={isLoggingOut}
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}""", 'logout button attrs')
t = t.replace('                退出登录\n', "                {isLoggingOut ? '正在退出…' : '退出登录'}\n", 1)
t = must_replace(t, "  const { session: ctx, status } = useAppSession();", "  const { session: ctx, status } = useAppSession();\n  const { isImpersonating } = useImpersonation();", 'Home impersonation context')
t = must_replace(t, "  const [showCommunication, setShowCommunication] = React.useState(false);", "  const [showCommunication, setShowCommunication] = React.useState(false);\n  const [isLoggingOut, setIsLoggingOut] = React.useState(false);", 'Home logout state')
t = must_replace(t, """  const activeSession = ctx;
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
  }""", """  const activeSession = ctx;
  const canSeeAdminWorkspace = isUserAdmin(activeSession.role) && !isImpersonating;

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      if (isImpersonating) clearImpersonationCache();
      const auditSession = isImpersonating ? await getSession().catch(() => null) : activeSession;
      if (auditSession?.user.email) await logActionImmediate(auditSession.user.email, 'LOGOUT', { platform: 'web' });
      await signOut();
    } finally {
      window.location.href = '/login';
    }
  }""", 'Home session/logout')
t = must_replace(t, """    const restricted = isModuleRestricted(workspace.module);
    const admin = isUserAdmin(activeSession.role);
    const canAccess = canAccessModule(workspace.module, activeSession.role);

    if (activeSession.user.email) {
      const details: Record<string, unknown> = { module: workspace.module, blocked: !canAccess };
      if (restricted && !admin) details.reason = 'restricted_module';
      logAction(activeSession.user.email, 'ENTER_MODULE', details);
    }

    if (!canAccess) { event.preventDefault(); return; }""", """    const admin = isUserAdmin(activeSession.role);
    const decision = getModuleAccessDecision(workspace.module, activeSession.role, {
      email: activeSession.user.email,
      isImpersonating,
    });
    const canAccess = decision.allowed;

    if (activeSession.user.email && (workspace.module !== 'admin' || !canAccess)) {
      const details: Record<string, unknown> = { module: workspace.module, blocked: !canAccess };
      if (!canAccess && decision.reason) details.reason = decision.reason;
      logAction(activeSession.user.email, 'ENTER_MODULE', details);
    }

    if (!canAccess) { event.preventDefault(); return; }""", 'Home activation')
t = must_replace(t, "            canSeeAdminWorkspace={canSeeAdminWorkspace}\n            onLogout", "            canSeeAdminWorkspace={canSeeAdminWorkspace}\n            isImpersonating={isImpersonating}\n            isLoggingOut={isLoggingOut}\n            onLogout", 'HomeHeader props')
write(p, t)

# Admin guard.
p = 'src/app/admin/layout.tsx'
t = read(p)
t = must_replace(t, "import { getSession, signOut } from '@/src/services/Auth';\nimport { isDemoMode } from '@/src/config/demoMode';\nimport { canAccessAdminConsole } from '@/src/utils/adminAccess';", "import { getSession, signOut } from '@/src/services/Auth';\nimport { logAction, logActionImmediate } from '@/src/utils/audit';\nimport { getModuleAccessDecision } from '@/src/utils/accessControl';", 'Admin imports')
t = must_replace(t, "  const [allowed, setAllowed] = React.useState(false);", "  const [allowed, setAllowed] = React.useState(false);\n  const [currentEmail, setCurrentEmail] = React.useState('');\n  const [isLoggingOut, setIsLoggingOut] = React.useState(false);", 'Admin state')
t = must_replace(t, """        const permitted = Boolean(session) && canAccessAdminConsole({
          role: session?.role,
          email: session?.user?.email,
          isDemo: isDemoMode(session?.user?.email),
        });

        if (!permitted) {
          router.replace('/');
          return;
        }

        setAllowed(true);
        setReady(true);""", """        const isImpersonating = typeof window !== 'undefined' && Boolean(sessionStorage.getItem('__impersonation_state'));
        const decision = getModuleAccessDecision('admin', session?.role, { email: session?.user?.email, isImpersonating });

        if (!session || !decision.allowed) {
          if (session?.user?.email && !isImpersonating) logAction(session.user.email, 'ENTER_MODULE', { module: 'admin', blocked: true, reason: decision.reason, source: 'route_guard' });
          router.replace('/');
          return;
        }

        setCurrentEmail(session.user.email ?? '');
        logAction(session.user.email, 'ENTER_MODULE', { module: 'admin', blocked: false, source: 'route_guard' });
        setAllowed(true);
        setReady(true);""", 'Admin guard')
t = must_replace(t, """  async function handleLogout() {
    try {
      await signOut();
    } finally {
      window.location.href = '/login';
    }
  }""", """  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      if (currentEmail) await logActionImmediate(currentEmail, 'LOGOUT', { platform: 'web', source: 'admin' });
      await signOut();
    } finally {
      window.location.href = '/login';
    }
  }""", 'Admin logout')
t = must_replace(t, '<button type="button" onClick={handleLogout} className=', '<button type="button" onClick={handleLogout} disabled={isLoggingOut} aria-busy={isLoggingOut} className=', 'Admin logout button')
t = t.replace('              退出\n            </button>', "              {isLoggingOut ? '退出中…' : '退出'}\n            </button>", 1)
write(p, t)

# Direct Lease guard.
p = 'src/app/lease-submission/layout.tsx'
t = read(p)
t = t.replace("import { canAccessModule } from '@/src/utils/accessControl';", "import { getModuleAccessDecision } from '@/src/utils/accessControl';\nimport { logAction } from '@/src/utils/audit';")
t = must_replace(t, """        if (!canAccessModule('lease-submission', session.role)) {
          router.replace('/');
          return;
        }

        setAuthorized(true);""", """        const decision = getModuleAccessDecision('lease-submission', session.role, { email: session.user.email });
        if (!decision.allowed) {
          if (session.user.email) logAction(session.user.email, 'ENTER_MODULE', { module: 'lease-submission', blocked: true, reason: decision.reason, source: 'route_guard' });
          router.replace('/');
          return;
        }

        setAuthorized(true);""", 'Lease guard')
write(p, t)

# Quarterly guard uses canonical helper before DB defense-in-depth role check.
p = 'src/app/update/components/QuarterlyUpdateWorkspace.tsx'
t = read(p)
t = t.replace("import { logAction } from '@/src/utils/audit';", "import { logAction } from '@/src/utils/audit';\nimport { getModuleAccessDecision } from '@/src/utils/accessControl';")
t = must_replace(t, """        const user = session.user;
        setCurrentUser(user);""", """        const user = session.user;
        const moduleDecision = getModuleAccessDecision('update', session.role, { email: user.email });
        if (!moduleDecision.allowed) {
          if (user.email) logAction(user.email, 'ENTER_MODULE', { module: 'update', blocked: true, reason: moduleDecision.reason, source: 'route_guard' });
          router.replace('/');
          return;
        }
        setCurrentUser(user);""", 'Quarterly guard')
write(p, t)

# Lease impersonation read-only + Demo non-elevation.
p = 'src/app/lease-submission/page.tsx'
t = read(p)
t = t.replace("import { isDemoMode } from '@/src/config/demoMode';\n", '')
t = t.replace("import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';", "import { ValidationMessage } from '@/src/components/data-entry/ValidationMessage';\nimport { useImpersonation } from '@/src/contexts/ImpersonationContext';")
t = must_replace(t, "  onTransfer: (record: LeaseTransaction) => void;\n}", "  onTransfer: (record: LeaseTransaction) => void;\n  readOnly?: boolean;\n}", 'History props')
t = must_replace(t, 'function MySubmissionTable({ items, userName, onEdit, onTransfer }: HistoryProps)', 'function MySubmissionTable({ items, userName, onEdit, onTransfer, readOnly = false }: HistoryProps)', 'History signature')
old = '<div className="inline-flex gap-1"><button type="button" onClick={() => onEdit(item)} className="inline-flex items-center gap-1 rounded-[4px] border border-zinc-200 px-2 py-1 text-[10px] font-semibold text-[#003e7e] hover:bg-[#003e7e]/5"><Edit2 size={11} /> 编辑</button><button type="button" onClick={() => onTransfer(item)} className="inline-flex items-center gap-1 rounded-[4px] border border-zinc-200 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50"><Gift size={11} /> 转交</button></div>'
new = '{readOnly ? <span className="text-[10px] text-zinc-400">只读</span> : <div className="inline-flex gap-1"><button type="button" onClick={() => onEdit(item)} className="inline-flex items-center gap-1 rounded-[4px] border border-zinc-200 px-2 py-1 text-[10px] font-semibold text-[#003e7e] hover:bg-[#003e7e]/5"><Edit2 size={11} /> 编辑</button><button type="button" onClick={() => onTransfer(item)} className="inline-flex items-center gap-1 rounded-[4px] border border-zinc-200 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50"><Gift size={11} /> 转交</button></div>}'
t = must_replace(t, old, new, 'Lease row actions')
t = must_replace(t, '  const router = useRouter();', '  const router = useRouter();\n  const { isImpersonating } = useImpersonation();', 'Lease impersonation')
t = must_replace(t, '    const admin = isUserAdmin(role);', '    const admin = isUserAdmin(role) && !isImpersonating;', 'Lease load admin')
t = must_replace(t, '  }, []);', '  }, [isImpersonating]);', 'Lease load deps')
t = must_replace(t, '  const openCreate = () => {\n    setEditingRecord', '  const openCreate = () => {\n    if (isImpersonating) return;\n    setEditingRecord', 'Lease create')
t = must_replace(t, '  const openEdit = (record: LeaseTransaction) => {\n    setEditingRecord', '  const openEdit = (record: LeaseTransaction) => {\n    if (isImpersonating) return;\n    setEditingRecord', 'Lease edit')
t = must_replace(t, '  const openTransfer = async (record: LeaseTransaction) => {\n    setTransferringRecord', '  const openTransfer = async (record: LeaseTransaction) => {\n    if (isImpersonating) return;\n    setTransferringRecord', 'Lease transfer')
t = must_replace(t, '  const confirmTransfer = async () => {\n    if (!transferringRecord', '  const confirmTransfer = async () => {\n    if (isImpersonating) return;\n    if (!transferringRecord', 'Lease confirm transfer')
t = must_replace(t, '  const admin = isUserAdmin(userRole);', '  const admin = isUserAdmin(userRole) && !isImpersonating;', 'Lease admin derived')
t = must_replace(t, '{(admin || isDemoMode(userEmail)) && <Link href="/lease-submission/monitoring"', '{admin && <Link href="/lease-submission/monitoring"', 'Lease demo monitor')
t = must_replace(t, '<button type="button" onClick={openCreate} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#003e7e] px-3 text-[11px] font-semibold text-white hover:bg-[#003566]"><Plus size={13} /> 新增成交</button>', '<button type="button" onClick={openCreate} disabled={isImpersonating} aria-disabled={isImpersonating} title={isImpersonating ? \'模拟模式仅供查看，不能写入数据\' : undefined} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#003e7e] px-3 text-[11px] font-semibold text-white hover:bg-[#003566] disabled:cursor-not-allowed disabled:opacity-50"><Plus size={13} /> {isImpersonating ? \'模拟模式只读\' : \'新增成交\'}</button>', 'Lease create button')
t = must_replace(t, '<MySubmissionTable items={submissions} userName={userName} onEdit={openEdit} onTransfer={openTransfer} />', '<MySubmissionTable items={submissions} userName={userName} onEdit={openEdit} onTransfer={openTransfer} readOnly={isImpersonating} />', 'Lease table call')
write(p, t)

p = 'src/app/lease-submission/monitoring/page.tsx'
t = read(p)
t = t.replace("import { isDemoMode } from '@/src/config/demoMode';\n", '')
t = must_replace(t, "        const isDemo = isDemoMode(session.user?.email);\n        if (!isUserAdmin(session.role) && !isDemo) {", "        if (!isUserAdmin(session.role)) {", 'Monitoring demo guard')
write(p, t)

# Research management uses shared impersonation context rather than raw storage checks.
p = 'src/components/OSSManager.tsx'
t = read(p)
if "useImpersonation" not in t:
    t = t.replace("'use client';", "'use client';\n\nimport { useImpersonation } from '@/src/contexts/ImpersonationContext';", 1)
t = t.replace('  const [isImpersonating, setIsImpersonating] = React.useState(false);', '  const { isImpersonating } = useImpersonation();')
t = re.sub(r"\n  React\.useEffect\(\(\) => \{\n    try \{\n      setIsImpersonating\(Boolean\(sessionStorage\.getItem\('__impersonation_state'\)\)\);\n    \} catch \{\n      setIsImpersonating\(false\);\n    \}\n  \}, \[\]\);", '', t)
write(p, t)

# Simulated admin never gains map edit controls.
p = 'src/app/map/MapClient.tsx'
t = read(p)
if "useImpersonation" not in t:
    t = t.replace("import { useAppSession } from '@/src/components/SessionProvider';", "import { useAppSession } from '@/src/components/SessionProvider';\nimport { useImpersonation } from '@/src/contexts/ImpersonationContext';")
t = must_replace(t, '  const { session: appSession, status: appSessionStatus } = useAppSession();', '  const { session: appSession, status: appSessionStatus } = useAppSession();\n  const { isImpersonating } = useImpersonation();', 'Map context')
t = must_replace(t, '    currentUserId,\n    onEditBuildingMetrics', '    currentUserId,\n    adminEditingEnabled: !isImpersonating,\n    onEditBuildingMetrics', 'Map runtime option')
write(p, t)

p = 'src/app/map/runtime/useMapRuntime.ts'
t = read(p)
t = must_replace(t, '  currentUserId: string | null;\n  onEditBuildingMetrics', '  currentUserId: string | null;\n  adminEditingEnabled?: boolean;\n  onEditBuildingMetrics', 'Map runtime type')
t = must_replace(t, '  currentUserId,\n  onEditBuildingMetrics,', '  currentUserId,\n  adminEditingEnabled = true,\n  onEditBuildingMetrics,', 'Map runtime destructure')
t = must_replace(t, "    const isAdmin = roleRef.current === 'admin';", "    const isAdmin = adminEditingEnabled && roleRef.current === 'admin';", 'Map admin mode')
t = must_replace(t, '  }, []);', '  }, [adminEditingEnabled]);', 'Map admin callback deps')
write(p, t)

# Settings shows role/access and blocks account mutation while simulated.
p = 'src/app/settings/page.tsx'
t = read(p)
t = t.replace("import { clearSessionCache, getSessionFast } from '@/src/services/Auth';", "import { clearSessionCache, getSessionFast } from '@/src/services/Auth';\nimport { useImpersonation } from '@/src/contexts/ImpersonationContext';\nimport { getModuleAccessDecision, getRoleLabel } from '@/src/utils/accessControl';")
t = must_replace(t, '  const router = useRouter();', '  const router = useRouter();\n  const { isImpersonating } = useImpersonation();', 'Settings context')
t = must_replace(t, "  const [displayName, setDisplayName] = React.useState('');", "  const [displayName, setDisplayName] = React.useState('');\n  const [userRole, setUserRole] = React.useState('');", 'Settings role state')
t = must_replace(t, '  const isLoadingUser = !userEmail;', "  const isLoadingUser = !userEmail;\n  const adminDecision = getModuleAccessDecision('admin', userRole, { email: userEmail, isImpersonating });\n  const roleLabel = getRoleLabel(userRole, userEmail);", 'Settings derived')
t = must_replace(t, "        setDisplayName(session.displayName ?? '');", "        setDisplayName(session.displayName ?? '');\n        setUserRole(session.role ?? '');", 'Settings set role')
t = must_replace(t, '    setMessage(null);', "    setMessage(null);\n    if (isImpersonating) { setMessage({ type: 'error', text: '模拟模式仅供查看，不能修改真实账号密码' }); return; }", 'Settings submit guard')
anchor = """            {passwordChangeRequired && (
              <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">
                首次登录需先修改临时密码。
              </div>
            )}"""
extra = anchor + """
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[11px]">
              <div><span className="text-zinc-400">当前身份</span><div className="mt-0.5 font-medium text-zinc-700">{roleLabel}{isImpersonating ? ' · 模拟只读' : ''}</div></div>
              <div><span className="text-zinc-400">系统管理</span><div className="mt-0.5 font-medium text-zinc-700">{adminDecision.allowed ? '可访问' : '无访问权限'}</div></div>
            </div>
            {isImpersonating && (
              <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">当前正在模拟该用户。账号级操作保持禁用，退出模拟后才能修改真实管理员账号。</div>
            )}"""
t = must_replace(t, anchor, extra, 'Settings identity panel')
t = t.replace('type="password" value={newPassword}', 'type="password" value={newPassword} disabled={isImpersonating}', 1)
t = t.replace('type="password" value={confirmPassword}', 'type="password" value={confirmPassword} disabled={isImpersonating}', 1)
t = t.replace('type="submit" disabled={submitting}', 'type="submit" disabled={submitting || isImpersonating}', 1)
write(p, t)

# Logout: cleanup failure cannot prevent local sign-out; clear auth/impersonation caches.
p = 'src/services/Auth.ts'
t = read(p)
t = must_replace(t, """export async function signOut(): Promise<void> {
  // 获取当前用户 ID
  const { data: { user } } = await supabase.auth.getUser();
  
  // 清除数据库中的 session_id（防止令牌重放攻击）
  if (user?.id) {
    await updateSessionId(user.id, null);
  }

  // 清除客户端缓存
  clearSessionCache();

  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`登出失败：${error.message}`);
}""", """export async function signOut(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) await updateSessionId(user.id, null);
  } catch (error) {
    console.warn('登出前清理 session_id 失败，继续执行本地登出:', error);
  }

  clearSessionCache();
  clearImpersonationCache();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  clearSessionCache();
  clearImpersonationCache();
  if (error) throw new Error(`登出失败：${error.message}`);
}""", 'Auth signOut')
write(p, t)

# Immediate audit confirms IndexedDB persistence before logout navigation; transport/retry remains unchanged.
p = 'src/utils/audit.ts'
t = read(p)
t = must_replace(t, """/** 兼容旧接口：关键事件只提前安排发送，仍不阻塞用户操作。 */
export async function logActionImmediate(
  userId: string | undefined,
  actionType: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  logAction(userId, actionType, details);
  scheduleFlush(0);
}""", """/** 关键生命周期事件先确认写入 IndexedDB，再允许页面导航；网络发送仍由原 outbox/retry 负责。 */
export async function logActionImmediate(
  _userId: string | undefined,
  actionType: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (sessionStorage.getItem('__impersonation_state')) return;
  } catch {}

  ensureInit();
  const queuedEvent: AuditEvent = {
    event_id: createEventId(),
    action_type: actionType,
    details,
    request_source: 'frontend',
    page_url: window.location.pathname,
    module: window.location.pathname.split('/')[1] || 'home',
    user_agent: typeof navigator === 'undefined' ? undefined : navigator.userAgent.slice(0, 500),
  };
  try {
    await saveEvent(queuedEvent);
    scheduleFlush(0);
  } catch {
    // Audit persistence failure never blocks logout/navigation.
  }
}""", 'Audit immediate')
write(p, t)

# Admin create-user must use canonical roles only.
p = 'src/app/api/admin/create-user/route.ts'
t = read(p)
t = t.replace("const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : 'user';", "const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : 'viewer';")
t = t.replace("if (!['admin', 'editor', 'user'].includes(normalizedRole))", "if (!['admin', 'editor', 'viewer'].includes(normalizedRole))")
write(p, t)

write('src/__tests__/identity-permission-hardening.test.ts', """import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canAccessModule, getModuleAccessDecision, getRoleLabel } from '@/src/utils/accessControl';
import { canAccessAdminConsole } from '@/src/utils/adminAccess';

const restrictedAdminEmail = 'judy.li@colliers.com';
const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('canonical role/module matrix', () => {
  it('enforces viewer/editor/admin product roles', () => {
    expect(canAccessModule('map', 'viewer')).toBe(true);
    expect(canAccessModule('oss', 'viewer')).toBe(true);
    expect(canAccessModule('update', 'viewer')).toBe(false);
    expect(canAccessModule('lease-submission', 'viewer')).toBe(false);
    expect(canAccessModule('admin', 'viewer')).toBe(false);
    expect(canAccessModule('update', 'editor')).toBe(true);
    expect(canAccessModule('lease-submission', 'editor')).toBe(true);
    expect(canAccessModule('admin', 'editor')).toBe(false);
    for (const moduleId of ['map', 'oss', 'update', 'lease-submission', 'admin']) expect(canAccessModule(moduleId, 'admin')).toBe(true);
  });

  it('fails unknown roles closed', () => {
    expect(getModuleAccessDecision('map', 'user')).toEqual({ allowed: false, reason: 'invalid_role' });
    expect(getModuleAccessDecision('map', 'super_admin')).toEqual({ allowed: false, reason: 'invalid_role' });
  });

  it('keeps Demo presentation-only', () => {
    expect(canAccessAdminConsole({ role: 'viewer', email: 'demo@colliers.com', isDemo: true })).toBe(false);
    expect(canAccessAdminConsole({ role: 'editor', email: 'demo@colliers.com', isDemo: true })).toBe(false);
  });

  it('keeps restricted admin explicit and blocks only the console', () => {
    expect(getRoleLabel('admin', restrictedAdminEmail)).toBe('受限管理员');
    expect(getModuleAccessDecision('admin', 'admin', { email: restrictedAdminEmail })).toEqual({ allowed: false, reason: 'restricted_admin' });
    expect(canAccessModule('update', 'admin', { email: restrictedAdminEmail })).toBe(true);
    expect(canAccessModule('lease-submission', 'admin', { email: restrictedAdminEmail })).toBe(true);
  });

  it('blocks Admin during impersonation', () => {
    expect(getModuleAccessDecision('admin', 'admin', { isImpersonating: true })).toEqual({ allowed: false, reason: 'impersonation_read_only' });
  });
});

describe('identity hardening source contracts', () => {
  it('removes Demo elevation and hard-coded Home identity rules', () => {
    const home = source('src/components/home/HomeWorkspace.tsx');
    const admin = source('src/app/admin/layout.tsx');
    expect(home).not.toContain("activeSession.user.email === 'judy.li@colliers.com'");
    expect(home).not.toContain('isDemoMode(activeSession.user.email)');
    expect(admin).not.toContain('isDemoMode');
  });

  it('keeps impersonation read-only on account and write surfaces', () => {
    expect(source('src/app/settings/page.tsx')).toContain('模拟模式仅供查看，不能修改真实账号密码');
    expect(source('src/components/OSSManager.tsx')).toContain('useImpersonation');
    expect(source('src/app/lease-submission/page.tsx')).toContain("isImpersonating ? '模拟模式只读' : '新增成交'");
    expect(source('src/app/map/MapClient.tsx')).toContain('adminEditingEnabled: !isImpersonating');
  });

  it('uses local sign-out and durable logout enqueue', () => {
    expect(source('src/services/Auth.ts')).toContain("supabase.auth.signOut({ scope: 'local' })");
    expect(source('src/utils/audit.ts')).toContain('await saveEvent(queuedEvent)');
  });

  it('creates only canonical roles', () => {
    const route = source('src/app/api/admin/create-user/route.ts');
    expect(route).toContain("['admin', 'editor', 'viewer']");
    expect(route).not.toContain("['admin', 'editor', 'user']");
  });
});
""")

p = 'CHANGELOG.md'
t = read(p)
entry = """## 2026-08-25 — Identity / Permission / Admin UX Hardening

- **Area:** Home module authorization, Admin console, Demo/restricted-admin identity, impersonation boundaries, logout/audit lifecycle.
- **Canonical roles:** `viewer / editor / admin` remain the only application roles. Demo remains presentation/masking only and no longer elevates Admin or team-monitor access.
- **Home / direct routes:** Quarterly and Lease are explicitly editor/admin modules; Admin is admin-only with the existing restricted-admin exception resolved through one policy helper. Unavailable business modules stay visible with `无访问权限`; viewer/editor do not get an Admin menu item. Restricted-admin is labelled `受限管理员` and receives a disabled Admin item rather than contradictory role/menu/direct-route states.
- **Admin:** `/admin` uses the same policy decision as Home, always authorizes from the real Supabase session, rejects Demo elevation and impersonation, and records allowed/blocked `ENTER_MODULE` decisions.
- **Impersonation:** Quarterly remains read-only; Lease create/edit/transfer/team-monitor actions are disabled; Research management consumes shared impersonation context; Map admin editing is disabled; Settings shows simulated identity/permission state while blocking password mutation. Start/end impersonation remains server-audited; ordinary simulated actions remain intentionally excluded from client audit attribution.
- **Logout:** session-id cleanup failure cannot prevent local Supabase sign-out; logout uses explicit local scope, clears auth/impersonation caches, and `LOGOUT` is durably queued to the existing IndexedDB outbox before navigation. Audit transport/retry was not redesigned.
- **Admin user creation:** removed legacy invalid `user` role; low-privilege accounts use canonical `viewer`.
- **Database note:** repository migrations establish viewer as read-only product role and the latest RLS removes viewer read access to lease transactions. No live RLS mutation was made in this pass because the connected schema query did not return a reliable result; existing migration history is left intact rather than guessed.
- **Verification:** `Typecheck → Lint → Test → Production Build` must pass before the workflow commits product changes. Real browser logout/network-throttling verification still requires an authenticated reachable Preview; automated contracts do not count as a browser pass.

"""
if not t.startswith(entry):
    write(p, entry + t)

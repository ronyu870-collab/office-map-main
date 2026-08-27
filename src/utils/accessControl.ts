import { RESTRICTED_MODULES } from '@/src/config/accessControl';
import { parseUserRole } from '@/src/types/auth';

/** 判断模块是否存在额外的角色限制。 */
export function isModuleRestricted(moduleId: string): boolean {
  return RESTRICTED_MODULES.some(module => module.module === moduleId);
}

/** 管理员判断统一依赖应用角色契约，未知角色一律不是管理员。 */
export function isUserAdmin(role: string | null | undefined): boolean {
  return parseUserRole(role) === 'admin';
}

/** 租赁成交团队汇总仅向可参与数据录入的内部角色开放。 */
export function canViewLeaseTeamSubmissions(
  role: string | null | undefined,
): boolean {
  const parsedRole = parseUserRole(role);
  return parsedRole === 'editor' || parsedRole === 'admin';
}

/**
 * 模块授权决策。
 *
 * - 未认证/未知角色：拒绝（fail closed）
 * - 未额外限制的模块：合法应用角色均可访问
 * - 受限模块：必须出现在 allowedRoles 中
 *
 * 该函数用于 UI 与客户端 route guard；真正的数据授权仍由 RLS/API 服务端校验负责。
 */
export function canAccessModule(
  moduleId: string,
  userRole: string | null | undefined,
): boolean {
  const role = parseUserRole(userRole);
  if (!role) return false;

  const restriction = RESTRICTED_MODULES.find(module => module.module === moduleId);
  if (!restriction) return true;

  return restriction.allowedRoles.includes(role);
}

export type ModuleStyles = {
  cardClass: string;
  iconClass: string;
  textClass: string;
  cursorClass: string;
};

export function getModuleStyles(
  moduleId: string,
  userRole: string | null | undefined,
): ModuleStyles {
  if (canAccessModule(moduleId, userRole)) {
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

export type AccessibilityProps = {
  'aria-disabled'?: 'true';
  'aria-label'?: string;
  role?: string;
};

export function getAccessibilityProps(
  moduleId: string,
  moduleTitle: string,
  userRole: string | null | undefined,
): AccessibilityProps {
  if (!canAccessModule(moduleId, userRole)) {
    return {
      'aria-disabled': 'true',
      'aria-label': `${moduleTitle} - 当前角色无权访问`,
      role: 'link',
    };
  }

  return { role: 'link' };
}

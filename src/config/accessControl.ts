import type { UserRole } from '@/src/types/auth';

/**
 * 受限模块定义。
 *
 * 本配置只描述已认证用户之间的角色授权；未认证用户应在页面 guard 中直接拒绝。
 */
export type RestrictedModule = {
  module: string;
  href: string;
  allowedRoles: readonly UserRole[];
};

/**
 * viewer 与 editor 共享相同的业务读取入口。
 *
 * 业务写权限不再通过“禁止进入模块”实现，而是在页面只读状态、服务端 API
 * 与 Supabase RLS 三层分别收口。系统管理仍由独立的 admin guard 控制。
 */
export const RESTRICTED_MODULES: readonly RestrictedModule[] = [];

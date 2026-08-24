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
 * 租赁成交填报属于 broker 工作流，因此 editor 与 admin 可访问。
 * viewer 仅承担受限只读场景，不应进入成交填报工作区。
 *
 * 注意：旧配置使用 `deals` / `/deals`，与实际路由和 NAV_MODULES 不一致，
 * 导致限制实际上没有应用到 `/lease-submission`。这里以真实产品路由为唯一契约。
 */
export const RESTRICTED_MODULES: readonly RestrictedModule[] = [
  {
    module: 'lease-submission',
    href: '/lease-submission',
    allowedRoles: ['editor', 'admin'],
  },
];

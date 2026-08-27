/**
 * 认证相关类型与角色契约
 * @module types/auth
 */

import type { Session, User } from '@supabase/supabase-js';

/**
 * 应用唯一合法角色集合。
 *
 * 数据库 public.user_roles.role 的约束与这里保持一致：
 * - viewer: 只读用户，数据范围受 RLS 限制
 * - editor: 业务编辑/填报用户
 * - admin: 管理员
 */
export const APP_ROLES = ['viewer', 'editor', 'admin'] as const;
export type UserRole = (typeof APP_ROLES)[number];

/** 仅用于界面显示；不会参与权限判断或写入数据库。 */
export const USER_ROLE_LABELS: Record<UserRole | 'user', string> = {
  viewer: '查看用户',
  user: '查看用户',
  editor: '编辑用户',
  admin: '管理员',
};

export function getUserRoleLabel(value: unknown): string {
  if (typeof value !== 'string') return '查看用户';
  const normalized = value.trim().toLowerCase() as keyof typeof USER_ROLE_LABELS;
  return USER_ROLE_LABELS[normalized] ?? '查看用户';
}

/**
 * 将外部/缓存中的未知值解析为合法角色。
 * 权限判断应优先使用本函数，并对 null 采用拒绝访问的安全默认值。
 */
export function parseUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (APP_ROLES as readonly string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

/**
 * 资料读取失败时降级为最小权限 viewer；不能用于判断“是否已认证”。
 */
export function normalizeUserRole(value: unknown): UserRole {
  return parseUserRole(value) ?? 'viewer';
}

/**
 * 认证会话结果
 */
export interface AuthSessionResult {
  user: User;
  session: Session;
  role: UserRole;
  displayName: string;
  sessionId: string;
}
